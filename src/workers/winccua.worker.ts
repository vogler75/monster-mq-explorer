// WinCC Unified uses the graphql-transport-ws protocol:
//   WebSocket subprotocol : "graphql-transport-ws"
//   connection_init / connection_ack handshake (token in connection_init payload)
//   "subscribe" to start, "next" for incoming notifications, "complete" to stop

declare const __ELECTRON__: boolean;
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";
import type { ConnectionConfig } from "../types/mqtt";

let activeWs: WebSocket | null = null;
let pendingMessages: SerializedMessage[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
const encoder = new TextEncoder();

function tagNameToTopic(name: string): string {
  // System1::Tag1.SubTag -> System1/Tag1/SubTag
  return name.replace(/::/g, "/").replace(/\./g, "/");
}

function startFlushing() {
  if (flushInterval !== null) return;
  flushInterval = setInterval(() => {
    if (pendingMessages.length === 0) return;
    const batch = pendingMessages;
    pendingMessages = [];
    const transferables = batch.map((m) => m.payload.buffer);
    self.postMessage({ type: "messages", batch } as WorkerEvent, transferables);
  }, 16);
}

function stopFlushing() {
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

function httpUrl(config: ConnectionConfig): string {
  const scheme = config.protocol === "wss" ? "https" : "http";
  return `${scheme}://${config.host}:${config.port}${config.path}`;
}

function wsUrl(config: ConnectionConfig): string {
  return `${config.protocol}://${config.host}:${config.port}${config.path}`;
}

function wsSend(socket: WebSocket, msg: object) {
  const text = JSON.stringify(msg);
  console.log("[WinCC UA] WS send →", text);
  socket.send(text);
}

async function graphqlPost(url: string, body: object, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // In the browser dev environment the request would be blocked by CORS.
  // Route through the Vite dev-server proxy instead. In Electron there is no
  // same-origin restriction so we can fetch the target URL directly.
  let fetchUrl = url;
  if (!__ELECTRON__) {
    headers["X-Wincc-Target"] = url;
    fetchUrl = "/api/winccua-proxy";
  }

  const res = await fetch(fetchUrl, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function connectToWinCCUA(config: ConnectionConfig) {
  const http = httpUrl(config);

  // Step 1 — Authenticate and obtain a Bearer token
  let token: string | undefined;
  if (config.username) {
    const loginBody = {
      query: `mutation { login(username: "${config.username}", password: "${config.password}") { token } }`,
    };
    console.log("[WinCC UA] Login request →", http, loginBody);
    let result: { data?: { login?: { token?: string } }; errors?: unknown[] };
    try {
      result = await graphqlPost(http, loginBody) as typeof result;
      console.log("[WinCC UA] Login response ←", JSON.stringify(result));
    } catch (err) {
      console.error("[WinCC UA] Login request failed:", err);
      self.postMessage({ type: "error", message: `Login request failed: ${err}` } as WorkerEvent);
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      return;
    }
    if (result.errors) {
      self.postMessage({ type: "error", message: `Login failed: ${JSON.stringify(result.errors)}` } as WorkerEvent);
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      return;
    }
    token = result.data?.login?.token;
    if (!token) {
      self.postMessage({ type: "error", message: "Login succeeded but returned no token" } as WorkerEvent);
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      return;
    }
    console.log("[WinCC UA] Login OK, token obtained");
  }

  // Step 2 — Browse tags via HTTP
  const nameFilters = config.subscriptions
    .map((s) => s.topic.trim())
    .filter((t) => t.length > 0);

  const browseBody = { query: `{ browse(nameFilters: ${JSON.stringify(nameFilters)}) { name objectType } }` };
  console.log("[WinCC UA] Browse request →", http, browseBody);

  let tagNames: string[];
  try {
    const result = await graphqlPost(http, browseBody, token
    ) as { data?: { browse?: { name: string; objectType: string }[] }; errors?: unknown[] };
    console.log("[WinCC UA] Browse response ←", JSON.stringify(result));

    if (result.errors) {
      self.postMessage({ type: "error", message: `Browse failed: ${JSON.stringify(result.errors)}` } as WorkerEvent);
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      return;
    }
    const allResults = result.data?.browse ?? [];
    tagNames = allResults
      .filter((r) => r.objectType?.toUpperCase().includes("TAG"))
      .map((r) => r.name);
    console.log("[WinCC UA] Tags to subscribe:", tagNames);
  } catch (err) {
    self.postMessage({ type: "error", message: `Browse request failed: ${err}` } as WorkerEvent);
    self.postMessage({ type: "disconnected" } as WorkerEvent);
    return;
  }

  if (tagNames.length === 0) {
    self.postMessage({ type: "error", message: "No tags found matching the name filters" } as WorkerEvent);
    self.postMessage({ type: "disconnected" } as WorkerEvent);
    return;
  }

  // Step 3 — Subscribe via graphql-transport-ws protocol (raw WebSocket).
  const ws = wsUrl(config);
  const subscriptionQuery = `subscription {
  tagValues(names: ${JSON.stringify(tagNames)}) {
    name
    value { value }
    error { code description }
    notificationReason
  }
}`;
  console.log("[WinCC UA] WebSocket URL:", ws);
  console.log("[WinCC UA] Subscription query:\n", subscriptionQuery);

  const socket = new WebSocket(ws, "graphql-transport-ws");
  activeWs = socket;

  socket.onopen = () => {
    console.log("[WinCC UA] WS open — sending connection_init");
    wsSend(socket, {
      type: "connection_init",
      payload: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  socket.onmessage = (event: MessageEvent) => {
    let msg: { type: string; id?: string; payload?: unknown };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      console.warn("[WinCC UA] WS unparseable message:", event.data);
      return;
    }
    if (msg.type !== "next") console.log("[WinCC UA] WS recv ←", JSON.stringify(msg));

    switch (msg.type) {
      case "connection_ack":
        console.log("[WinCC UA] connection_ack — sending subscribe");
        wsSend(socket, {
          type: "subscribe",
          id: "sub1",
          payload: { query: subscriptionQuery },
        });
        self.postMessage({ type: "connected" } as WorkerEvent);
        startFlushing();
        break;

      case "next": {
        type Notification = { name: string; value?: { value: unknown }; notificationReason?: string };
        const n = (msg.payload as { data?: { tagValues?: Notification } })?.data?.tagValues;
        if (!n?.name) return;
        const payload = encoder.encode(
          JSON.stringify({ name: n.name, value: n.value?.value ?? null })
        );
        pendingMessages.push({
          topic: tagNameToTopic(n.name),
          payload,
          qos: 0,
          retain: false,
          timestamp: Date.now(),
        });
        break;
      }

      case "error":
        console.error("[WinCC UA] subscription error:", JSON.stringify(msg.payload));
        self.postMessage({ type: "error", message: `Subscription error: ${JSON.stringify(msg.payload)}` } as WorkerEvent);
        break;

      case "complete":
        console.log("[WinCC UA] subscription complete");
        stopFlushing();
        break;

      case "ping":
        // graphql-transport-ws requires responding to pings
        wsSend(socket, { type: "pong" });
        break;
    }
  };

  socket.onerror = (event) => {
    console.error("[WinCC UA] WS error:", event);
    self.postMessage({ type: "error", message: "WebSocket error" } as WorkerEvent);
  };

  socket.onclose = (event) => {
    console.log("[WinCC UA] WS closed — code:", event.code, "reason:", event.reason);
    stopFlushing();
    if (activeWs === socket) {
      activeWs = null;
      self.postMessage({ type: "disconnected" } as WorkerEvent);
    }
  };
}

function disconnectFromWinCCUA() {
  if (activeWs) {
    try {
      if (activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({ type: "complete", id: "sub1" }));
      }
    } catch { /* ignore */ }
    activeWs.close();
    activeWs = null;
  }
  stopFlushing();
  pendingMessages = [];
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;
  switch (cmd.type) {
    case "connect":
      disconnectFromWinCCUA();
      connectToWinCCUA(cmd.config);
      break;
    case "disconnect":
      disconnectFromWinCCUA();
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      break;
  }
};
