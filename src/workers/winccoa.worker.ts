// WinCC Open Architecture uses the graphql-transport-ws protocol (same as WinCC UA):
//   WebSocket subprotocol: "graphql-transport-ws"
//   connection_init / connection_ack handshake (token in connection_init payload)
//   "subscribe" to start, "next" for incoming notifications, "complete" to stop
//
// Subscriptions:
//   Wildcard filters → dpQueryConnectSingle(query: "SELECT '.value' FROM 'pattern'", answer: true)
//   Explicit tag lists → dpConnect(dpeNames: [...], answer: true) in chunks of CHUNK_SIZE

declare const __ELECTRON__: boolean | undefined;
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";
import type { ConnectionConfig } from "../types/mqtt";

const CHUNK_SIZE = 255;

let activeWs: WebSocket | null = null;
let activeSubIds: string[] = [];
let activeTagPathSplitters: string[] = [":", "."];
let pendingMessages: SerializedMessage[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
const encoder = new TextEncoder();

// Track subscription type so we can parse "next" events correctly
type SubKind = "dpQueryConnectSingle" | "dpConnect";
const subKinds = new Map<string, SubKind>();
let subIdCounter = 0;

function nextSubId(): string {
  subIdCounter += 1;
  return `sub${subIdCounter}`;
}

function tagNameToTopic(name: string, splitters: string[]): string {
  let result = name;
  for (const s of splitters) {
    result = result.split(s).join("/");
  }
  return result;
}

function startFlushing() {
  if (flushInterval !== null) return;
  flushInterval = setInterval(() => {
    if (pendingMessages.length === 0) return;
    const batch = pendingMessages;
    pendingMessages = [];
    const transferables = batch.map((m) => m.payload.buffer as ArrayBuffer);
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
  socket.send(JSON.stringify(msg));
}

function sendDpQueryConnectAll(socket: WebSocket, query: string): string {
  const id = nextSubId();
  subKinds.set(id, "dpQueryConnectSingle");
  activeSubIds.push(id);
  console.log(`[WinCC OA] dpQueryConnectSingle ${id} query: ${query}`);
  wsSend(socket, {
    type: "subscribe",
    id,
    payload: {
      query: `subscription($query: String!, $answer: Boolean) {
  dpQueryConnectSingle(query: $query, answer: $answer) { values type error }
}`,
      variables: { query, answer: true },
    },
  });
  return id;
}

function sendDpConnect(socket: WebSocket, dpeNames: string[]): string {
  const id = nextSubId();
  subKinds.set(id, "dpConnect");
  activeSubIds.push(id);
  console.log(`[WinCC OA] dpConnect ${id} (${dpeNames.length} tags)`);
  wsSend(socket, {
    type: "subscribe",
    id,
    payload: {
      query: `subscription($dpeNames: [String!]!, $answer: Boolean) {
  dpConnect(dpeNames: $dpeNames, answer: $answer) { dpeNames values type error }
}`,
      variables: { dpeNames, answer: true },
    },
  });
  return id;
}

function emitMessage(name: string, value: unknown, stime?: unknown, status?: unknown) {
  const obj: Record<string, unknown> = { name, value: value ?? null };
  if (stime !== undefined && stime !== null) obj.stime = stime;
  if (status !== undefined && status !== null) obj.status = status;
  const payload = encoder.encode(JSON.stringify(obj));
  pendingMessages.push({
    topic: tagNameToTopic(name, activeTagPathSplitters),
    payload,
    qos: 0,
    retain: false,
    timestamp: Date.now(),
  });
}

async function graphqlPost(url: string, body: object, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let fetchUrl = url;
  if (typeof __ELECTRON__ === "undefined" || !__ELECTRON__) {
    headers["X-Wincc-Target"] = url;
    fetchUrl = "/api/winccua-proxy";
  }

  const res = await fetch(fetchUrl, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function connectToWinCCOA(config: ConnectionConfig) {
  activeTagPathSplitters = [":", "."].concat(
    config.tagPathSplit
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== ":" && s !== ".")
  );
  const http = httpUrl(config);

  // Step 1 — Authenticate
  let token: string | undefined;
  if (config.username) {
    const loginBody = {
      query: `mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { token } }`,
      variables: { username: config.username, password: config.password },
    };
    console.log("[WinCC OA] Login request →", http, loginBody);
    let result: { data?: { login?: { token?: string } }; errors?: unknown[] };
    try {
      result = await graphqlPost(http, loginBody) as typeof result;
      console.log("[WinCC OA] Login response ←", JSON.stringify(result));
    } catch (err) {
      console.error("[WinCC OA] Login request failed:", err);
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
    console.log("[WinCC OA] Login OK, token obtained");
  }

  // Step 2 — Resolve wildcard filter subscriptions to explicit tag lists via dpNames
  const filterSubs = config.subscriptions.filter((s) => !s.tags || s.tags.length === 0);
  const explicitTagSubs = config.subscriptions.filter((s) => s.tags && s.tags.length > 0);

  // Collect unique filter patterns from filter subscriptions
  const filterPatterns = filterSubs
    .map((s) => s.topic.trim())
    .filter((t) => t.length > 0);

  // For explicit tag subs, flatten all tags
  const explicitTags = explicitTagSubs.flatMap((s) => s.tags!);

  console.log(`[WinCC OA] Filter patterns: ${filterPatterns.length}, explicit tags: ${explicitTags.length}`);

  if (filterPatterns.length === 0 && explicitTags.length === 0) {
    self.postMessage({ type: "error", message: "No subscriptions configured" } as WorkerEvent);
    self.postMessage({ type: "disconnected" } as WorkerEvent);
    return;
  }

  // Step 3 — Open WebSocket
  const ws = wsUrl(config);
  console.log("[WinCC OA] WebSocket URL:", ws);

  const socket = new WebSocket(ws, "graphql-transport-ws");
  activeWs = socket;
  subIdCounter = 0;
  activeSubIds = [];
  subKinds.clear();

  socket.onopen = () => {
    console.log("[WinCC OA] WS open — sending connection_init");
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
      console.warn("[WinCC OA] WS unparseable message:", event.data);
      return;
    }


    switch (msg.type) {
      case "connection_ack":
        console.log("[WinCC OA] connection_ack — sending subscriptions");

        // Wildcard filter subscriptions → one dpQueryConnectSingle per pattern
        for (const pattern of filterPatterns) {
          sendDpQueryConnectAll(socket, `SELECT '_original.._value', '_original.._stime', '_original.._status' FROM '${pattern}'`);
        }

        // Explicit tag subscriptions → dpConnect in chunks
        // Tags without "." have no element specified — append "." to reference the root element
        const dpeNames = explicitTags.map((t) => t.includes(".") ? t : `${t}.`);
        for (let i = 0; i < dpeNames.length; i += CHUNK_SIZE) {
          sendDpConnect(socket, dpeNames.slice(i, i + CHUNK_SIZE));
        }

        self.postMessage({ type: "connected" } as WorkerEvent);
        startFlushing();
        break;

      case "next": {
        const kind = subKinds.get(msg.id ?? "");

        if (kind === "dpQueryConnectSingle") {
          type DpQueryUpdate = { values?: unknown[][]; type?: string; error?: unknown };
          const update = (msg.payload as { data?: { dpQueryConnectSingle?: DpQueryUpdate } })?.data?.dpQueryConnectSingle;
          if (!update) return;
          if (update.error) {
            console.error(`[WinCC OA] dpQueryConnectSingle error (${msg.id}):`, JSON.stringify(update.error));
            return;
          }
          const rows = update.values ?? [];
          for (const row of rows) {
            if (!Array.isArray(row) || row.length < 2) continue;
            if (row[0] === "" || row[0] === null) continue; // header row
            const dpName = String(row[0]);
            if (config.filterInternalTags && dpName.split(":").pop()!.startsWith("_")) continue;
            const value = row[1] ?? null;
            const stime = row[2] ?? null;
            const status = row[3] ?? null;
            emitMessage(dpName, value, stime, status);
          }
        } else if (kind === "dpConnect") {
          type DpConnectUpdate = { dpeNames?: string[]; values?: unknown[]; type?: string; error?: unknown };
          const update = (msg.payload as { data?: { dpConnect?: DpConnectUpdate } })?.data?.dpConnect;
          if (!update) return;
          if (update.error) {
            console.error(`[WinCC OA] dpConnect error (${msg.id}):`, JSON.stringify(update.error));
            return;
          }
          const names = update.dpeNames ?? [];
          const values = update.values ?? [];
          for (let i = 0; i < names.length; i++) {
            if (config.filterInternalTags && names[i].split(":").pop()!.startsWith("_")) continue;
            emitMessage(names[i], values[i] ?? null);
          }
        }
        break;
      }

      case "error":
        console.error(`[WinCC OA] subscription error (${msg.id}):`, JSON.stringify(msg.payload));
        self.postMessage({ type: "error", message: `Subscription error (${msg.id}): ${JSON.stringify(msg.payload)}` } as WorkerEvent);
        break;

      case "complete":
        console.log(`[WinCC OA] subscription complete (${msg.id})`);
        break;

      case "ping":
        wsSend(socket, { type: "pong" });
        break;
    }
  };

  socket.onerror = (event) => {
    console.error("[WinCC OA] WS error:", event);
    self.postMessage({ type: "error", message: "WebSocket error" } as WorkerEvent);
  };

  socket.onclose = (event) => {
    console.log("[WinCC OA] WS closed — code:", event.code, "reason:", event.reason);
    stopFlushing();
    if (activeWs === socket) {
      activeWs = null;
      self.postMessage({ type: "disconnected" } as WorkerEvent);
    }
  };
}

function disconnectFromWinCCOA() {
  if (activeWs) {
    try {
      if (activeWs.readyState === WebSocket.OPEN) {
        for (const id of activeSubIds) {
          activeWs.send(JSON.stringify({ type: "complete", id }));
        }
      }
    } catch { /* ignore */ }
    activeWs.close();
    activeWs = null;
  }
  activeSubIds = [];
  subKinds.clear();
  stopFlushing();
  pendingMessages = [];
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;
  switch (cmd.type) {
    case "connect":
      disconnectFromWinCCOA();
      connectToWinCCOA(cmd.config);
      break;
    case "disconnect":
      disconnectFromWinCCOA();
      self.postMessage({ type: "disconnected" } as WorkerEvent);
      break;
  }
};
