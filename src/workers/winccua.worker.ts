// WinCC Unified uses the graphql-transport-ws protocol:
//   WebSocket subprotocol : "graphql-transport-ws"
//   connection_init / connection_ack handshake (token in connection_init payload)
//   "subscribe" to start, "next" for incoming notifications, "complete" to stop

declare const __ELECTRON__: boolean;
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";
import type { ConnectionConfig } from "../types/mqtt";

const CHUNK_SIZE = 255;

let activeWs: WebSocket | null = null;
let activeSubIds: string[] = [];
let activeTagPathSplitters: string[] = ["::"];
let pendingMessages: SerializedMessage[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
const encoder = new TextEncoder();

// Per-subscription state used to detect and retry failed tags after "Added" notifications
interface SubState {
  tags: string[];
  pendingAdded: Set<string>; // tags not yet seen in an "Added" notification
  failedTags: Set<string>;   // tags whose "Added" had error.code !== "0"
}
const subStates = new Map<string, SubState>();
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

function buildQuery(tags: string[]): string {
  return `subscription {
  tagValues(names: ${JSON.stringify(tags)}) {
    name
    value { value quality { quality subStatus } }
    error { code description }
    notificationReason
  }
}`;
}

function sendSubscribe(socket: WebSocket, tags: string[]): string {
  const id = nextSubId();
  subStates.set(id, {
    tags,
    pendingAdded: new Set(tags),
    failedTags: new Set(),
  });
  activeSubIds.push(id);
  console.log(`[WinCC UA] subscribe ${id} (${tags.length} tags)`);
  wsSend(socket, { type: "subscribe", id, payload: { query: buildQuery(tags) } });
  return id;
}

async function graphqlPost(url: string, body: object, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

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
  activeTagPathSplitters = ["::"].concat(
    config.tagPathSplit
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "::")
  );
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
    const allTagNames = allResults
      .filter((r) => r.objectType?.toUpperCase().includes("TAG"))
      .map((r) => r.name);
    tagNames = allTagNames.filter((name) => !name.includes("@"));
    const skipped = allTagNames.length - tagNames.length;
    console.log(`[WinCC UA] Tags to subscribe: ${tagNames.length} (skipped ${skipped} internal tags with @)`);
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
  // Tags are split into chunks of CHUNK_SIZE to stay within server limits.
  const chunks: string[][] = [];
  for (let i = 0; i < tagNames.length; i += CHUNK_SIZE) {
    chunks.push(tagNames.slice(i, i + CHUNK_SIZE));
  }
  console.log(`[WinCC UA] Subscribing to ${tagNames.length} tags in ${chunks.length} chunk(s) of max ${CHUNK_SIZE}`);

  const ws = wsUrl(config);
  console.log("[WinCC UA] WebSocket URL:", ws);

  const socket = new WebSocket(ws, "graphql-transport-ws");
  activeWs = socket;
  subIdCounter = 0;
  activeSubIds = [];
  subStates.clear();

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
    console.log("[WinCC UA] WS recv ←", JSON.stringify(msg));

    switch (msg.type) {
      case "connection_ack":
        console.log(`[WinCC UA] connection_ack — sending ${chunks.length} subscribe(s)`);
        chunks.forEach((chunk) => sendSubscribe(socket, chunk));
        self.postMessage({ type: "connected" } as WorkerEvent);
        startFlushing();
        break;

      case "next": {
        type TagError = { code: string; description: string };
        type Quality = { quality?: string; subStatus?: string };
        type Notification = { name: string; value?: { value: unknown; quality?: Quality }; error?: TagError; notificationReason?: string };
        const n = (msg.payload as { data?: { tagValues?: Notification } })?.data?.tagValues;
        if (!n?.name) return;

        // Track "Added" notifications to detect failed tags and retry without them
        if (n.notificationReason === "Added") {
          const state = subStates.get(msg.id ?? "");
          if (state) {
            state.pendingAdded.delete(n.name);
            if (n.error && n.error.code !== "0") {
              state.failedTags.add(n.name);
              console.warn(`[WinCC UA] Tag subscription failed (${msg.id}): ${n.name} — ${n.error.description}`);
            }
            // Once all Added notifications received, retry without failed tags
            if (state.pendingAdded.size === 0 && state.failedTags.size > 0) {
              console.log(`[WinCC UA] ${msg.id}: ${state.failedTags.size} failed tag(s), retrying ${state.tags.length - state.failedTags.size} good tag(s)`);
              wsSend(socket, { type: "complete", id: msg.id });
              activeSubIds = activeSubIds.filter((id) => id !== msg.id);
              subStates.delete(msg.id ?? "");
              const goodTags = state.tags.filter((t) => !state.failedTags.has(t));
              if (goodTags.length > 0) sendSubscribe(socket, goodTags);
            }
          }
          return; // don't emit "Added" as a message value
        }

        const payload = encoder.encode(
          JSON.stringify({
            name: n.name,
            value: n.value?.value ?? null,
            quality: n.value?.quality?.quality ?? null,
            subStatus: n.value?.quality?.subStatus ?? null,
          })
        );
        pendingMessages.push({
          topic: tagNameToTopic(n.name, activeTagPathSplitters),
          payload,
          qos: 0,
          retain: false,
          timestamp: Date.now(),
        });
        break;
      }

      case "error":
        console.error(`[WinCC UA] subscription error (${msg.id}):`, JSON.stringify(msg.payload));
        self.postMessage({ type: "error", message: `Subscription error (${msg.id}): ${JSON.stringify(msg.payload)}` } as WorkerEvent);
        break;

      case "complete":
        console.log(`[WinCC UA] subscription complete (${msg.id})`);
        break;

      case "ping":
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
        for (const id of activeSubIds) {
          activeWs.send(JSON.stringify({ type: "complete", id }));
        }
      }
    } catch { /* ignore */ }
    activeWs.close();
    activeWs = null;
  }
  activeSubIds = [];
  subStates.clear();
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
