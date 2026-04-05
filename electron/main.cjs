const { app, BrowserWindow, shell, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const mqtt = require("mqtt");
const pkg = require("../package.json");

app.setVersion(pkg.version);

// ---------- Clear cached HSTS state ----------
// Chromium caches Strict-Transport-Security headers and silently upgrades
// ws:// to wss:// and http:// to https:// for hosts that previously sent HSTS.
// This breaks plain WS/HTTP connections to WinCC servers.
// Delete the TransportSecurity file before Chromium loads it.
try {
  const tsFile = path.join(app.getPath("userData"), "TransportSecurity");
  fs.unlinkSync(tsFile);
} catch { /* file may not exist — that's fine */ }

// Keep a global reference so the window is not garbage-collected
let mainWindow;

// ---------- TLS certificate error bypass ----------
// Hosts for which cert errors should be ignored (populated via IPC from renderer)
const ignoreCertHosts = new Set();

function applyCertVerifyProc() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (ignoreCertHosts.has(request.hostname)) {
      callback(0); // 0 = OK, bypass verification
    } else {
      callback(-3); // -3 = use default Chromium verification
    }
  });
}

// Fallback: catch certificate errors that setCertificateVerifyProc may miss
// (e.g. fetch/WebSocket from Web Workers).
app.on("certificate-error", (event, _webContents, url, _error, _cert, callback) => {
  try {
    const hostname = new URL(url).hostname;
    if (ignoreCertHosts.has(hostname)) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch { /* malformed URL — fall through */ }
  callback(false);
});

ipcMain.handle("ignore-cert-hosts", (_event, hosts) => {
  ignoreCertHosts.clear();
  for (const h of hosts) ignoreCertHosts.add(h);
  applyCertVerifyProc();
});

// ---------- GraphQL proxy for WinCC UA/OA ----------
// Routes HTTP requests through Node.js, bypassing Chromium's network stack
// (avoids HSTS upgrades and Web Worker cert-verify limitations).
ipcMain.handle("graphql-proxy", (_event, { url, body, token, ignoreCertErrors }) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? require("https") : require("http");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const payload = JSON.stringify(body);
    headers["Content-Length"] = Buffer.byteLength(payload);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers,
    };
    if (isHttps && ignoreCertErrors) {
      options.rejectUnauthorized = false;
    }

    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
});

// ---------- TCP MQTT connections managed in main process ----------
const tcpClients = new Map(); // connectionId -> { client, pendingMessages, flushScheduled }

function sendToRenderer(connectionId, event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mqtt-tcp-event", connectionId, event);
  }
}

function flushBatch(connectionId) {
  const state = tcpClients.get(connectionId);
  if (!state || state.pendingMessages.length === 0) {
    if (state) state.flushScheduled = false;
    return;
  }
  const batch = state.pendingMessages;
  state.pendingMessages = [];
  state.flushScheduled = false;
  // Convert Buffer payloads to arrays for structured clone over IPC
  const serialized = batch.map((m) => ({
    ...m,
    payload: Array.from(m.payload),
  }));
  sendToRenderer(connectionId, { type: "messages", batch: serialized });
}

function scheduleFlush(connectionId) {
  const state = tcpClients.get(connectionId);
  if (state && !state.flushScheduled) {
    state.flushScheduled = true;
    setTimeout(() => flushBatch(connectionId), 16);
  }
}

function handleTcpConnect(connectionId, config) {
  // Tear down any existing connection for this id
  const existing = tcpClients.get(connectionId);
  if (existing && existing.client) {
    existing.client.end(true);
  }

  const { host, port, protocol, username, password, clientId } = config;
  const url = `${protocol}://${host}:${port}`;

  console.log(`[mqtt-tcp] Connecting to ${url} (clientId: ${clientId})`);

  const opts = {
    clientId,
    username: username || undefined,
    password: password || undefined,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  // For mqtts (TLS), optionally allow self-signed / untrusted certificates
  if (protocol === "mqtts" && config.ignoreCertErrors) {
    opts.rejectUnauthorized = false;
  }

  const client = mqtt.connect(url, opts);

  const state = { client, pendingMessages: [], flushScheduled: false };
  tcpClients.set(connectionId, state);

  client.on("connect", () => {
    sendToRenderer(connectionId, { type: "connected" });
    for (const sub of config.subscriptions) {
      client.subscribe(sub.topic, { qos: sub.qos }, (err) => {
        if (err) {
          sendToRenderer(connectionId, { type: "error", message: `Subscribe failed: ${sub.topic}: ${err.message}` });
        } else {
          sendToRenderer(connectionId, { type: "subscribed", topic: sub.topic });
        }
      });
    }
  });

  client.on("message", (topic, payload, packet) => {
    state.pendingMessages.push({
      topic,
      payload: new Uint8Array(payload),
      qos: packet.qos,
      retain: packet.retain,
      timestamp: Date.now(),
    });
    scheduleFlush(connectionId);
  });

  client.on("error", (err) => {
    sendToRenderer(connectionId, { type: "error", message: err.message });
  });

  client.on("close", () => {
    sendToRenderer(connectionId, { type: "disconnected" });
  });

  client.on("offline", () => {
    sendToRenderer(connectionId, { type: "disconnected", reason: "offline" });
  });
}

function handleTcpCommand(connectionId, cmd) {
  if (cmd.type === "connect") {
    handleTcpConnect(connectionId, cmd.config);
    return;
  }

  const state = tcpClients.get(connectionId);
  if (!state || !state.client) return;

  switch (cmd.type) {
    case "disconnect":
      state.client.end(true);
      tcpClients.delete(connectionId);
      break;
    case "subscribe":
      state.client.subscribe(cmd.topic, { qos: cmd.qos }, (err) => {
        if (err) {
          sendToRenderer(connectionId, { type: "error", message: `Subscribe failed: ${err.message}` });
        } else {
          sendToRenderer(connectionId, { type: "subscribed", topic: cmd.topic });
        }
      });
      break;
    case "unsubscribe":
      state.client.unsubscribe(cmd.topic);
      break;
    case "publish":
      state.client.publish(cmd.topic, cmd.payload, { qos: cmd.qos, retain: cmd.retain });
      break;
  }
}

ipcMain.on("mqtt-tcp", (_event, connectionId, command) => {
  handleTcpCommand(connectionId, command);
});

// ---------- Window creation ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: `Monster MQTT Explorer v${pkg.version}`,
    icon: path.join(__dirname, "../dist/icons/icon-512.png"),
    backgroundColor: "#0f172a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // preload needs require('electron')
      webSecurity: false, // allow cross-origin fetch to WinCC UA / other local servers
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

  // Open external links in the OS browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  applyCertVerifyProc();

  // Strip Strict-Transport-Security headers from all responses so Chromium
  // never caches HSTS for any host.  This prevents silent ws→wss / http→https
  // upgrades that break plain-text connections to WinCC servers.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    delete headers["strict-transport-security"];
    delete headers["Strict-Transport-Security"];
    callback({ responseHeaders: headers });
  });

  createWindow();
});

app.on("window-all-closed", () => {
  // Clean up all TCP connections
  for (const [, state] of tcpClients) {
    if (state.client) state.client.end(true);
  }
  tcpClients.clear();

  // On macOS apps stay active until the user quits explicitly
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS re-create the window when the dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
