import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import type { WorkerCommand } from "./workers/mqtt.protocol";
import type { WorkerEvent } from "./workers/mqtt.protocol";
import { useConnections } from "./stores/connections";
import { useTopicTree } from "./stores/topics";
import { useUI } from "./stores/ui";
import { useMessageLog } from "./stores/messageLog";
import { useWatchlist } from "./stores/watchlist";
import Toolbar from "./components/layout/Toolbar";
import Sidebar from "./components/layout/Sidebar";
import DetailPane from "./components/layout/DetailPane";
import ConnectionModal from "./components/connection/ConnectionModal";
import SubscriptionModal from "./components/connection/SubscriptionPanel";

// One worker per connection, keyed by connectionId
const workers = new Map<string, Worker>();

function getOrCreateWorker(connectionId: string, type: "mqtt" | "winccua" | "winccoa"): Worker {
  let w = workers.get(connectionId);
  if (!w) {
    const url = type === "winccua"
      ? new URL("./workers/winccua.worker.ts", import.meta.url)
      : type === "winccoa"
        ? new URL("./workers/winccoa.worker.ts", import.meta.url)
        : new URL("./workers/mqtt.worker.ts", import.meta.url);
    w = new Worker(url, { type: "module" });
    workers.set(connectionId, w);
  }
  return w;
}

export default function App() {
  const { connections, activeConnectionId, setActiveConnectionId, getConnection } =
    useConnections();
  const { processBatch } = useTopicTree();
  const { getConnectionStatus, setConnectionStatus, showConnectionModal, showSubscriptionModal, setPublishFn, setSubscribeFn, setUnsubscribeFn, autoExpand, expandTopics, selectedTopic } = useUI();
  const { addMessages } = useMessageLog();
  const { pinnedTopics } = useWatchlist();

  const [sidebarWidth, setSidebarWidth] = createSignal(320);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth();
    function onMove(e: MouseEvent) {
      setSidebarWidth(Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + e.clientX - startX)));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function setupWorkerListeners(w: Worker, connectionId: string) {
    w.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const event = e.data;
      switch (event.type) {
        case "connected":
          setConnectionStatus(connectionId, "connected");
          break;
        case "disconnected":
          setConnectionStatus(connectionId, "disconnected");
          break;
        case "error":
          console.error(`[Worker:${connectionId}]`, event.message);
          break;
        case "messages": {
          const config = getConnection(connectionId);
          const batch = config?.connectionType === "mqtt"
            ? event.batch.map((m) => ({ ...m, topic: `${config.name}/${m.topic}` }))
            : event.batch;
          const newTopics = processBatch(batch);
          addMessages(batch, selectedTopic(), pinnedTopics());
          if (autoExpand() && newTopics.length > 0) {
            expandTopics(newTopics);
          }
          break;
        }
        case "subscribed":
          console.log(`[Worker:${connectionId}] Subscribed:`, event.topic);
          break;
      }
    };
  }

  function activeWorker(): Worker | null {
    const id = activeConnectionId();
    return id ? workers.get(id) ?? null : null;
  }

  function connect(connectionId: string) {
    const config = getConnection(connectionId);
    if (!config) return;
    const w = getOrCreateWorker(connectionId, config.connectionType);
    setupWorkerListeners(w, connectionId);
    setConnectionStatus(connectionId, "connecting");
    setActiveConnectionId(connectionId);
    const plainConfig = JSON.parse(JSON.stringify(unwrap(config)));
    w.postMessage({ type: "connect", config: plainConfig } as WorkerCommand);
  }

  function disconnect() {
    const id = activeConnectionId();
    if (!id) return;
    const w = workers.get(id);
    if (w) w.postMessage({ type: "disconnect" } as WorkerCommand);
    setConnectionStatus(id, "disconnected");
  }

  function publish(topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) {
    const w = activeWorker();
    if (w) w.postMessage({ type: "publish", topic, payload, qos, retain } as WorkerCommand);
  }

  function subscribe(topic: string, qos: 0 | 1 | 2) {
    const w = activeWorker();
    if (w) w.postMessage({ type: "subscribe", topic, qos } as WorkerCommand);
  }

  function unsubscribe(topic: string) {
    const w = activeWorker();
    if (w) w.postMessage({ type: "unsubscribe", topic } as WorkerCommand);
  }

  setPublishFn(publish);
  setSubscribeFn(subscribe);
  setUnsubscribeFn(unsubscribe);

  onCleanup(() => {
    for (const w of workers.values()) w.terminate();
    workers.clear();
  });

  return (
    <div class="h-full flex flex-col bg-slate-900">
      <Toolbar onConnect={connect} onDisconnect={disconnect} />
      <div class="flex flex-1 overflow-hidden">
        <div style={{ width: `${sidebarWidth()}px`, "min-width": "200px", "max-width": "80vw" }} class="shrink-0">
          <Sidebar />
        </div>
        <div
          class="w-1.5 cursor-col-resize bg-slate-700 hover:bg-blue-500 active:bg-blue-500 transition-colors shrink-0"
          onMouseDown={startResize}
        />
        <DetailPane />
      </div>
      <Show when={showConnectionModal()}>
        <ConnectionModal />
      </Show>
      <Show when={showSubscriptionModal()}>
        <SubscriptionModal />
      </Show>
    </div>
  );
}
