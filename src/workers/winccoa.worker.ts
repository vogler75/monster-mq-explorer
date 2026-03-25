// WinCC Open Architecture uses the graphql-transport-ws protocol (same as WinCC UA):
//   WebSocket subprotocol: "graphql-transport-ws"
//   connection_init / connection_ack handshake (token in connection_init payload)
//   "subscribe" to start, "next" for incoming notifications, "complete" to stop
//
// All subscriptions use dpQueryConnectSingle with a SELECT query:
//   Wildcard filters:  FROM 'System1:*'
//   Explicit tag list: FROM '{Tag1.,Tag2.}'  (batched in chunks of CHUNK_SIZE)
//
// Each result row is: [dpeName, value, stime, status]
// where dpeName is the full DPE name including attribute (e.g. "System1:Tag._original.._value").
// We strip the "._original.." suffix to get the clean DP element name for the topic.

declare const __ELECTRON__: boolean | undefined;
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";
import type { ConnectionConfig } from "../types/mqtt";

const CHUNK_SIZE = 255;

let activeWs: WebSocket | null = null;
let activeSubIds: string[] = [];
let activeTagPathSplitters: string[] = [":"];
let pendingMessages: SerializedMessage[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
const encoder = new TextEncoder();

let subIdCounter = 0;

function nextSubId(): string {
  subIdCounter += 1;
  return `sub${subIdCounter}`;
}

function tagNameToTopic(name: string, splitters: string[]): string {
  // Strip trailing splitter characters (e.g. a trailing "." in WinCC OA tag names)
  // before replacing them with "/" to avoid a trailing slash in the topic path.
  let result = name;
  let trimmed = true;
  while (trimmed && result.length > 0) {
    trimmed = false;
    for (const s of splitters) {
      if (result.endsWith(s)) { result = result.slice(0, -s.length); trimmed = true; }
    }
  }
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
    const transferables = batch.map((m) => m.payload.buffer);
    self.postMessage({ type: "messages", batch } as WorkerEvent, { transfer: transferables });
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

function sendDpQueryConnect(socket: WebSocket, query: string): string {
  const id = nextSubId();
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
  activeTagPathSplitters = [...new Set([":"].concat([...config.tagPathSplit]))];
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

  // Step 2 — Collect all subscription patterns.
  // Wildcard filter subs go directly as FROM patterns.
  // Explicit tag subs are resolved to DP names via dpNames HTTP query first.
  const filterPatterns = config.subscriptions
    .filter((s) => !s.tags || s.tags.length === 0)
    .map((s) => s.topic.trim())
    .filter((t) => t.length > 0);

  const explicitTags = config.subscriptions
    .filter((s) => s.tags && s.tags.length > 0)
    .flatMap((s) => s.tags!);

  console.log(`[WinCC OA] Filter patterns: ${filterPatterns.length}, explicit tags: ${explicitTags.length}`);

  if (filterPatterns.length === 0 && explicitTags.length === 0) {
    self.postMessage({ type: "error", message: "No subscriptions configured" } as WorkerEvent);
    self.postMessage({ type: "disconnected" } as WorkerEvent);
    return;
  }

  // Build chunks of explicit tags for batched queries, same as WinCC UA.
  // Each tag gets a trailing "." so WinCC OA treats it as a root element reference.
  // The FROM list syntax is: '{Tag1.,Tag2.,Tag3.}'
  const explicitChunks: string[][] = [];
  for (let i = 0; i < explicitTags.length; i += CHUNK_SIZE) {
    explicitChunks.push(explicitTags.slice(i, i + CHUNK_SIZE));
  }
  console.log(`[WinCC OA] Subscribing with ${filterPatterns.length} filter pattern(s) + ${explicitChunks.length} explicit chunk(s) of max ${CHUNK_SIZE} tags`);

  // Step 3 — Open WebSocket and subscribe
  const ws = wsUrl(config);
  console.log("[WinCC OA] WebSocket URL:", ws);

  const socket = new WebSocket(ws, "graphql-transport-ws");
  activeWs = socket;
  subIdCounter = 0;
  activeSubIds = [];

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

        // One dpQueryConnectSingle per wildcard filter pattern
        for (const pattern of filterPatterns) {
          sendDpQueryConnect(socket, `SELECT '_original.._value', '_original.._stime', '_original.._status' FROM '${pattern}'`);
        }

        // Explicit tags: one dpQueryConnectSingle per chunk using the list syntax {Tag1.**,Tag2.**}
        // Tags without a "." are bare DP names — append ".**" to subscribe to all elements.
        // Tags that already contain a "." specify a particular element and are used as-is.
        for (const chunk of explicitChunks) {
          const list = chunk.map((t) => (t.includes(".") ? t : `${t}.**`)).join(",");
          sendDpQueryConnect(socket, `SELECT '_original.._value', '_original.._stime', '_original.._status' FROM '{${list}}'`);
        }

        self.postMessage({ type: "connected" } as WorkerEvent);
        startFlushing();
        break;

      case "next": {
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
          if (row[0] === "" || row[0] === null) continue; // skip header row

          // row[0] is the full DPE name including the attribute suffix, e.g.:
          //   "System1:ExampleDP.bt.x1._original.._value"
          // Strip everything from "._original.." onward to get the clean element name.
          const fullDpe = String(row[0]);
          const attrIdx = fullDpe.indexOf("._original..");
          const name = attrIdx >= 0 ? fullDpe.slice(0, attrIdx) : fullDpe;

          if (config.filterInternalTags && name.split(":").pop()!.startsWith("_")) continue;

          const value = row[1] ?? null;
          const stime = row[2] ?? null;
          const status = row[3] ?? null;

          const obj: Record<string, unknown> = { name, value };
          if (stime !== null) obj.stime = stime;
          if (status !== null) obj.status = status;
          pendingMessages.push({
            topic: tagNameToTopic(name, activeTagPathSplitters),
            payload: encoder.encode(JSON.stringify(obj)),
            qos: 0,
            retain: false,
            timestamp: Date.now(),
          });
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
