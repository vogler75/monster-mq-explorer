import { batch, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { unwrap } from "solid-js/store";
import type { WorkerCommand } from "./workers/mqtt.protocol";
import type { WorkerEvent } from "./workers/mqtt.protocol";
import { useConnections } from "./stores/connections";
import { useTopicTree } from "./stores/topics";
import { useUI } from "./stores/ui";
import { broadcastMessages, broadcastChartMessage } from "./stores/tabStore";
import { fetchArchiveGroups } from "./lib/monstermq-api";
import { login as winccUaLogin, loginAndBrowse as winccUaBrowse } from "./lib/winccua-api";
import { login as winccOaLogin, loginAndBrowse as winccOaBrowse } from "./lib/winccoa-api";
import { createIpcAdapter, hasMqttIpc, type WorkerLike } from "./lib/mqtt-ipc";
import Toolbar from "./components/layout/Toolbar";
import Sidebar from "./components/layout/Sidebar";
import DetailPane from "./components/layout/DetailPane";
import PublishPane from "./components/detail/PublishPane";
import ConnectionModal from "./components/connection/ConnectionModal";
import SubscriptionModal from "./components/connection/SubscriptionPanel";

// One worker (or IPC adapter) per connection, keyed by connectionId
const workers = new Map<string, Worker | WorkerLike>();
// Track whether each connection uses IPC so we can detect protocol switches
const workerIsIpc = new Map<string, boolean>();

function isTcpProtocol(protocol: string): boolean {
  return protocol === "mqtt" || protocol === "mqtts";
}

function getOrCreateWorker(connectionId: string, type: "mqtt" | "winccua" | "winccoa", protocol?: string): Worker | WorkerLike {
  const needsIpc = !!(protocol && isTcpProtocol(protocol) && hasMqttIpc());
  let w = workers.get(connectionId);

  // If the worker type changed (e.g. switched from ws to tcp or vice versa), tear down the old one
  if (w && workerIsIpc.get(connectionId) !== needsIpc) {
    w.postMessage({ type: "disconnect" });
    w.terminate();
    workers.delete(connectionId);
    workerIsIpc.delete(connectionId);
    w = undefined;
  }

  if (!w) {
    if (needsIpc) {
      w = createIpcAdapter(connectionId);
    } else if (type === "winccua") {
      w = new Worker(new URL("./workers/winccua.worker.ts", import.meta.url), { type: "module" });
    } else if (type === "winccoa") {
      w = new Worker(new URL("./workers/winccoa.worker.ts", import.meta.url), { type: "module" });
    } else {
      w = new Worker(new URL("./workers/mqtt.worker.ts", import.meta.url), { type: "module" });
    }
    workers.set(connectionId, w);
    workerIsIpc.set(connectionId, needsIpc);
  }
  return w;
}

export default function App() {
  const { connections, activeConnectionId, setActiveConnectionId, getConnection, removeConnection } =
    useConnections();
  const { processBatch } = useTopicTree();
  const { getConnectionStatus, setConnectionStatus, setArchiveGroups, setWinccToken, setTopicTagNameMap, clearConnectionState, showConnectionModal, showSubscriptionModal, showPublishPanel, setPublishFn, setSubscribeFn, setUnsubscribeFn, setDeleteConnectionFn, autoExpand, expandTopics, selectedTopic } = useUI();

  const [sidebarWidth, setSidebarWidth] = createSignal(320);
  const [rightPanelWidth, setRightPanelWidth] = createSignal(300);

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

  function startRightResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth();
    function onMove(e: MouseEvent) {
      setRightPanelWidth(Math.max(200, Math.min(window.innerWidth * 0.5, startWidth - (e.clientX - startX))));
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

  function setupWorkerListeners(w: Worker | WorkerLike, connectionId: string) {
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
          const msgs = config?.connectionType === "mqtt"
            ? event.batch.map((m) => ({ ...m, topic: `${config.name}/${m.topic}` }))
            : event.batch;
          // Single batch so tree update + expand are applied atomically
          batch(() => {
            const newTopics = processBatch(msgs);
            broadcastMessages(msgs);
            for (const m of msgs) {
              broadcastChartMessage(m.topic, m.payload, m.timestamp);
            }
            if (autoExpand() && newTopics.length > 0) {
              expandTopics(newTopics);
            }
          });
          break;
        }
        case "subscribed":
          console.log(`[Worker:${connectionId}] Subscribed:`, event.topic);
          break;
      }
    };
  }

  function activeWorker(): Worker | WorkerLike | null {
    const id = activeConnectionId();
    return id ? workers.get(id) ?? null : null;
  }

  /** Sync the set of TLS-cert-bypass hosts to the Electron main process */
  function syncIgnoreCertHosts() {
    if (!window.mqttIpc?.setIgnoreCertHosts) return;
    const hosts = connections
      .filter((c) => c.ignoreCertErrors && (c.protocol === "wss" || c.protocol === "mqtts"))
      .map((c) => c.host);
    window.mqttIpc.setIgnoreCertHosts(hosts);
  }

  function connect(connectionId: string) {
    const config = getConnection(connectionId);
    if (!config) return;
    syncIgnoreCertHosts();
    const w = getOrCreateWorker(connectionId, config.connectionType, config.protocol);
    setupWorkerListeners(w, connectionId);
    setConnectionStatus(connectionId, "connecting");
    setActiveConnectionId(connectionId);
    const plainConfig = JSON.parse(JSON.stringify(unwrap(config)));
    w.postMessage({ type: "connect", config: plainConfig } as WorkerCommand);

    if (config.isMonsterMq && config.monsterMqGraphqlUrl) {
      fetchArchiveGroups(config.monsterMqGraphqlUrl)
        .then((groups) => setArchiveGroups(connectionId, groups.map((g) => g.name)))
        .catch((err) => console.error(`[MonsterMQ:${connectionId}] Failed to fetch archive groups:`, err));
    }

    if (config.connectionType === "winccua") {
      const browseConfig = { host: config.host, port: config.port, protocol: config.protocol as "ws" | "wss", path: config.path, username: config.username, password: config.password };
      // Login and build topic→tagName mapping for history queries
      const splitters = [...new Set(["::"].concat([...config.tagPathSplit]))];
      function tagNameToTopic(name: string): string {
        let result = name;
        for (const s of splitters) result = result.split(s).join("/");
        return result;
      }
      const nameFilters = config.subscriptions
        .filter((s) => !s.tags || s.tags.length === 0)
        .map((s) => s.topic.trim())
        .filter((t) => t.length > 0);
      const explicitTags = config.subscriptions
        .filter((s) => s.tags && s.tags.length > 0)
        .flatMap((s) => s.tags!);

      (async () => {
        try {
          const token = await winccUaLogin(browseConfig);
          if (token) setWinccToken(connectionId, token);

          let browsedTags: string[] = [];
          if (nameFilters.length > 0) {
            browsedTags = await winccUaBrowse(browseConfig, nameFilters);
          }
          const allTags = [...explicitTags, ...browsedTags];
          const mapping = new Map<string, string>();
          for (const tag of allTags) {
            mapping.set(tagNameToTopic(tag), tag);
          }
          setTopicTagNameMap(connectionId, mapping);
        } catch (err) {
          console.error(`[WinCC UA:${connectionId}] Failed to build tag mapping:`, err);
        }
      })();
    }

    if (config.connectionType === "winccoa") {
      const browseConfig = { host: config.host, port: config.port, protocol: config.protocol as "ws" | "wss", path: config.path, username: config.username, password: config.password };
      const splitters = [...new Set([":"].concat([...config.tagPathSplit]))];
      function oaTagNameToTopic(name: string): string {
        let result = name;
        for (const s of splitters) result = result.split(s).join("/");
        while (result.endsWith("/")) result = result.slice(0, -1);
        return result;
      }
      const nameFilters = config.subscriptions
        .filter((s) => !s.tags || s.tags.length === 0)
        .map((s) => s.topic.trim())
        .filter((t) => t.length > 0);
      const explicitTags = config.subscriptions
        .filter((s) => s.tags && s.tags.length > 0)
        .flatMap((s) => s.tags!);

      (async () => {
        try {
          const token = await winccOaLogin(browseConfig);
          if (token) setWinccToken(connectionId, token);

          let browsedTags: string[] = [];
          if (nameFilters.length > 0) {
            browsedTags = await winccOaBrowse(browseConfig, nameFilters);
          }
          const allTags = [...explicitTags, ...browsedTags];
          const mapping = new Map<string, string>();
          for (const tag of allTags) {
            mapping.set(oaTagNameToTopic(tag), tag);
          }
          setTopicTagNameMap(connectionId, mapping);
        } catch (err) {
          console.error(`[WinCC OA:${connectionId}] Failed to build tag mapping:`, err);
        }
      })();
    }
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

  function deleteConnection(connectionId: string) {
    const w = workers.get(connectionId);
    if (w) {
      w.postMessage({ type: "disconnect" } as WorkerCommand);
      w.terminate();
      workers.delete(connectionId);
      workerIsIpc.delete(connectionId);
    }
    clearConnectionState(connectionId);
    removeConnection(connectionId);
  }

  setPublishFn(publish);
  setSubscribeFn(subscribe);
  setUnsubscribeFn(unsubscribe);
  setDeleteConnectionFn(deleteConnection);

  onCleanup(() => {
    for (const w of workers.values()) w.terminate();
    workers.clear();
    workerIsIpc.clear();
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
        <Show when={showPublishPanel()}>
          <div
            class="w-1.5 cursor-col-resize bg-slate-700 hover:bg-blue-500 active:bg-blue-500 transition-colors shrink-0"
            onMouseDown={startRightResize}
          />
          <div style={{ width: `${rightPanelWidth()}px`, "min-width": "200px" }} class="shrink-0">
            <PublishPane />
          </div>
        </Show>
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
