import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import type { WorkerCommand } from "./workers/mqtt.protocol";
import type { WorkerEvent } from "./workers/mqtt.protocol";
import { useConnections } from "./stores/connections";
import { useTopicTree } from "./stores/topics";
import { useUI } from "./stores/ui";
import { useMessageLog } from "./stores/messageLog";
import Toolbar from "./components/layout/Toolbar";
import Sidebar from "./components/layout/Sidebar";
import DetailPane from "./components/layout/DetailPane";
import ConnectionModal from "./components/connection/ConnectionModal";
import SubscriptionModal from "./components/connection/SubscriptionPanel";

// Create workers
let worker: Worker | null = null;
let winccuaWorker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./workers/mqtt.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

function getWinCCUAWorker(): Worker {
  if (!winccuaWorker) {
    winccuaWorker = new Worker(
      new URL("./workers/winccua.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
  return winccuaWorker;
}

export default function App() {
  const { connections, activeConnectionId, setActiveConnectionId, getConnection } =
    useConnections();
  const { processBatch, clearTree } = useTopicTree();
  const { setConnectionStatus, showConnectionModal, showSubscriptionModal, connectionStatus, setPublishFn, setSubscribeFn, setUnsubscribeFn, autoExpand, expandTopics, selectedTopic } = useUI();
  const { addMessages } = useMessageLog();

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = createSignal(320);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth();

    function onMove(e: MouseEvent) {
      const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + e.clientX - startX));
      setSidebarWidth(newWidth);
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

  function setupWorkerListeners(w: Worker) {
    w.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const event = e.data;
      switch (event.type) {
        case "connected":
          setConnectionStatus("connected");
          break;
        case "disconnected":
          setConnectionStatus("disconnected");
          break;
        case "error":
          console.error("[MQTT]", event.message);
          break;
        case "messages": {
          const newTopics = processBatch(event.batch);
          addMessages(event.batch, selectedTopic());
          if (autoExpand() && newTopics.length > 0) {
            expandTopics(newTopics);
          }
          break;
        }
        case "subscribed":
          console.log("[MQTT] Subscribed:", event.topic);
          break;
      }
    };
  }

  function activeWorker(): Worker | null {
    const config = activeConnectionId() ? getConnection(activeConnectionId()!) : null;
    if (config?.connectionType === "winccua") return winccuaWorker;
    return worker;
  }

  function connect(connectionId: string) {
    const config = getConnection(connectionId);
    if (!config) return;

    const w = config.connectionType === "winccua" ? getWinCCUAWorker() : getWorker();
    setupWorkerListeners(w);

    setConnectionStatus("connecting");
    setActiveConnectionId(connectionId);
    clearTree();

    const plainConfig = JSON.parse(JSON.stringify(unwrap(config)));
    const cmd: WorkerCommand = { type: "connect", config: plainConfig };
    w.postMessage(cmd);
  }

  function publish(topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) {
    const w = activeWorker();
    if (w) {
      const cmd: WorkerCommand = { type: "publish", topic, payload, qos, retain };
      w.postMessage(cmd);
    }
  }

  setPublishFn(publish);

  function subscribe(topic: string, qos: 0 | 1 | 2) {
    const w = activeWorker();
    if (w) {
      const cmd: WorkerCommand = { type: "subscribe", topic, qos };
      w.postMessage(cmd);
    }
  }

  function unsubscribe(topic: string) {
    const w = activeWorker();
    if (w) {
      const cmd: WorkerCommand = { type: "unsubscribe", topic };
      w.postMessage(cmd);
    }
  }

  setSubscribeFn(subscribe);
  setUnsubscribeFn(unsubscribe);

  function disconnect() {
    const w = activeWorker();
    if (w) {
      const cmd: WorkerCommand = { type: "disconnect" };
      w.postMessage(cmd);
    }
    setConnectionStatus("disconnected");
  }

  onCleanup(() => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (winccuaWorker) {
      winccuaWorker.terminate();
      winccuaWorker = null;
    }
  });

  return (
    <div class="h-full flex flex-col bg-slate-900">
      <Toolbar
        onConnect={connect}
        onDisconnect={disconnect}
      />
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
