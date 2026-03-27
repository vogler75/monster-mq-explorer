import { Show, For, createMemo, createSignal, createEffect, onMount, on, onCleanup, useContext, type Accessor, type Setter } from "solid-js";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import MessageDetail from "../detail/MessageDetail";
import MessageTable from "../detail/MessageTable";
import ChartPane from "../detail/ChartPane";
import type { LoggedMessage } from "../../stores/messageLog";
import {
  TabContext,
  createTabStores,
  registerTab,
  unregisterTab,
  useTabPinnedTopics,
  type TabContextValue,
} from "../../stores/tabStore";

interface TabState {
  id: string;
  label: string;
  stores: TabContextValue;
  selectedTopic: Accessor<string | null>;
  setSelectedTopic: Setter<string | null>;
}

let tabIdCounter = 0;

export default function DetailPane() {
  const { selectedTopic: globalSelectedTopic } = useUI();

  // ── Tab management ────────────────────────────────────────────────

  function makeTab(): TabState {
    const num = ++tabIdCounter;
    const id = `tab-${num}`;
    const [selectedTopic, setSelectedTopic] = createSignal<string | null>(null);
    const stores = createTabStores(selectedTopic);
    return { id, label: `#${num}`, stores, selectedTopic, setSelectedTopic };
  }

  const defaultTab = makeTab();
  const [tabs, setTabs] = createSignal<TabState[]>([defaultTab]);
  const [activeTabId, setActiveTabId] = createSignal(defaultTab.id);

  // Register default tab
  registerTab({
    id: defaultTab.id,
    selectedTopic: defaultTab.selectedTopic,
    pinnedTopics: defaultTab.stores.pinnedTopics.pinnedTopics,
    messageLog: defaultTab.stores.messageLog,
    chartData: defaultTab.stores.chartData,
  });
  onCleanup(() => {
    for (const tab of tabs()) unregisterTab(tab.id);
  });

  // Forward global tree selection → active tab only
  createEffect(on(globalSelectedTopic, (topic) => {
    const active = tabs().find((t) => t.id === activeTabId());
    if (active) active.setSelectedTopic(topic);
  }));

  function openNewTab() {
    const tab = makeTab();
    // Initialize new tab with current global selection
    tab.setSelectedTopic(globalSelectedTopic());
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);

    registerTab({
      id: tab.id,
      selectedTopic: tab.selectedTopic,
      pinnedTopics: tab.stores.pinnedTopics.pinnedTopics,
      messageLog: tab.stores.messageLog,
      chartData: tab.stores.chartData,
    });
  }

  function closeTab(id: string) {
    const current = tabs();
    if (current.length <= 1) return;
    unregisterTab(id);
    const idx = current.findIndex((t) => t.id === id);
    const next = current.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabId() === id) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveTabId(next[newIdx].id);
    }
  }

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-900 min-w-0">
      {/* Tab bar */}
      <div class="flex items-center bg-slate-800/60 border-b border-slate-700 shrink-0 min-h-0 overflow-x-auto">
        <For each={tabs()}>
          {(tab) => (
            <button
              class="group relative flex items-center gap-1.5 px-3 py-1 text-xs border-r border-slate-700 shrink-0 transition-colors"
              classList={{
                "bg-slate-900 text-blue-400": activeTabId() === tab.id,
                "text-slate-400 hover:text-slate-200 hover:bg-slate-800": activeTabId() !== tab.id,
              }}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.label}</span>
              <Show when={tabs().length > 1}>
                <span
                  class="ml-1 p-0.5 rounded hover:bg-slate-600 text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                >
                  <svg class="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2 2l6 6M8 2l-6 6" />
                  </svg>
                </span>
              </Show>
            </button>
          )}
        </For>
        <button
          class="px-2 py-1 text-xs text-slate-500 hover:text-blue-400 hover:bg-slate-800 transition-colors shrink-0"
          onClick={openNewTab}
          title="Open new tab"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 2v10M2 7h10" />
          </svg>
        </button>
      </div>

      {/* Tab content: render all, hide inactive to preserve state */}
      <For each={tabs()}>
        {(tab) => (
          <div
            class="flex-1 flex flex-col overflow-hidden min-w-0"
            style={{ display: activeTabId() === tab.id ? undefined : "none" }}
          >
            <TabContext.Provider value={tab.stores}>
              <TabContent />
            </TabContext.Provider>
          </div>
        )}
      </For>
    </div>
  );
}

// ── TabContent: the per-tab detail pane content ─────────────────────

function TabContent() {
  const { topicTree } = useTopicTree();

  // Per-tab stores from context
  const ctx = useContext(TabContext)!;
  const { logEnabled, setLogEnabled, logMode, liveTopics, clearLog, seedLiveFromTree } = ctx.messageLog;
  const { initSeries, setChartActive, clearAll, ensureSeries, chartActive } = ctx.chartData;
  const { pinnedTopics } = useTabPinnedTopics();

  // This tab's own selected topic (set by parent only when this tab is active)
  const selectedTopic = ctx.selectedTopic;

  const [tableHeight, setTableHeight] = createSignal(0);
  const [detailMode, setDetailMode] = createSignal<"detail" | "chart">("detail");

  let containerRef!: HTMLDivElement;

  onMount(() => {
    const setHalf = () => {
      const h = containerRef.getBoundingClientRect().height;
      if (h > 0) {
        setTableHeight(Math.floor(h / 2));
      } else {
        requestAnimationFrame(setHalf);
      }
    };
    setHalf();
  });

  const [selectedLogMsg, setSelectedLogMsg] = createSignal<LoggedMessage | null>(null);
  const [selectedLiveTopic, setSelectedLiveTopic] = createSignal<string | null>(null);

  const selectedNode = createMemo(() => {
    const topic = selectedTopic();
    if (!topic) return null;
    return getNodeByTopic(topicTree, topic);
  });

  // Clear log and selection when topic changes, then seed live topics
  createEffect(on(selectedTopic, (topic) => {
    setSelectedLogMsg(null);
    setSelectedLiveTopic(null);
    clearLog(pinnedTopics());
    if (topic) {
      const node = getNodeByTopic(topicTree, topic);
      if (node) seedLiveFromTree(node);
    }
  }));

  // When chart is active and pinned topics change, ensure series exist for new topics
  createEffect(on(pinnedTopics, (pinned) => {
    if (!chartActive()) return;
    for (const topic of pinned) {
      ensureSeries(topic, liveTopics[topic]?.payload);
    }
  }));

  // Clear selection when switching modes; re-seed live topics when entering live mode.
  createEffect(on(logMode, (mode) => {
    setSelectedLogMsg(null);
    setSelectedLiveTopic(null);
    if (mode === "live") {
      const topic = selectedTopic();
      if (topic) {
        const node = getNodeByTopic(topicTree, topic);
        if (node) seedLiveFromTree(node);
      }
    }
  }));

  function handleSelectMessage(msg: LoggedMessage | null) {
    if (logMode() === "live") {
      setSelectedLiveTopic(msg ? msg.topic : null);
    } else {
      setSelectedLogMsg(msg);
    }
  }

  const overrideMessage = createMemo<LoggedMessage | null>(() => {
    if (logMode() === "live") {
      const topic = selectedLiveTopic();
      return topic ? (liveTopics[topic] ?? null) : null;
    }
    return selectedLogMsg();
  });

  const selectedMessageId = createMemo<number | null>(() => {
    if (logMode() === "live") {
      const topic = selectedLiveTopic();
      return topic ? (liveTopics[topic]?.id ?? null) : null;
    }
    return selectedLogMsg()?.id ?? null;
  });

  function startSplitResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = tableHeight();
    function onMove(ev: MouseEvent) {
      const containerH = containerRef.getBoundingClientRect().height;
      const newH = Math.max(80, Math.min(containerH - 120, startH + ev.clientY - startY));
      setTableHeight(newH);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div ref={containerRef!} class="flex-1 flex flex-col overflow-hidden bg-slate-900 min-w-0">
      {/* Table/Chart toggle strip */}
      <div class="flex items-center px-3 py-0.5 border-b border-slate-700 bg-slate-800/40 shrink-0 gap-2">
        {/* Current topic */}
        <Show when={selectedTopic()}>
          <span class="text-xs text-slate-400 font-mono truncate max-w-[300px]" title={selectedTopic()!}>
            {selectedTopic()}
          </span>
          <div class="w-px h-3.5 bg-slate-600 shrink-0" />
        </Show>
        <button
          class="flex items-center gap-1.5 text-xs transition-colors"
          classList={{
            "text-blue-400": tableHeight() > 0,
            "text-slate-500 hover:text-slate-300": tableHeight() === 0,
          }}
          onClick={() => {
            const opening = tableHeight() === 0;
            setTableHeight(opening ? Math.floor(containerRef.getBoundingClientRect().height / 2) : 0);
            setLogEnabled(opening);
          }}
          title={tableHeight() > 0 ? "Hide message log" : "Show message log"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="1" y="2" width="12" height="10" rx="1" />
            <path d="M1 5h12M5 5v7" />
          </svg>
          <span>Table</span>
        </button>

        <button
          class="flex items-center gap-1.5 text-xs transition-colors"
          classList={{
            "text-blue-400": chartActive(),
            "text-slate-500 hover:text-slate-300": !chartActive(),
          }}
          onClick={() => {
            if (chartActive()) {
              setChartActive(false);
              clearAll();
              if (detailMode() === "chart") setDetailMode("detail");
            } else {
              initSeries(pinnedTopics(), (t) => liveTopics[t]?.payload);
              setChartActive(true);
              setDetailMode("chart");
            }
          }}
          title={chartActive() ? "Stop chart (clears data)" : "Start chart"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M1 11V3M1 11h12M3 9l3-4 3 2 4-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Chart</span>
        </button>

        <Show when={chartActive()}>
          <div class="flex items-center border-l border-slate-600 pl-2 ml-0.5 gap-1">
            <button
              class="px-1.5 py-0.5 text-xs rounded transition-colors"
              classList={{
                "bg-slate-700 text-blue-400": detailMode() === "detail",
                "text-slate-500 hover:text-slate-300": detailMode() !== "detail",
              }}
              onClick={() => setDetailMode("detail")}
              title="Show payload detail"
            >
              Detail
            </button>
            <button
              class="px-1.5 py-0.5 text-xs rounded transition-colors"
              classList={{
                "bg-slate-700 text-blue-400": detailMode() === "chart",
                "text-slate-500 hover:text-slate-300": detailMode() !== "chart",
              }}
              onClick={() => setDetailMode("chart")}
              title="Show chart"
            >
              Graph
            </button>
          </div>
        </Show>
      </div>

      {/* Table pane */}
      <Show when={tableHeight() > 0}>
        <div
          class="shrink-0 overflow-hidden flex flex-col border-b border-slate-700"
          style={{ height: `${tableHeight()}px` }}
        >
          <MessageTable
            onSelectMessage={handleSelectMessage}
            selectedMessageId={selectedMessageId()}
          />
        </div>
        <div
          class="h-1 shrink-0 cursor-row-resize bg-slate-700 hover:bg-blue-500 transition-colors"
          onMouseDown={startSplitResize}
        />
      </Show>

      {/* Detail pane */}
      <div class="flex-1 overflow-hidden min-h-0">
        <Show
          when={detailMode() === "chart"}
          fallback={
            <Show
              when={selectedNode()}
              fallback={
                <div class="h-full flex items-center justify-center text-slate-500 text-sm">
                  Click a topic in the tree to view its data
                </div>
              }
            >
              {(node) => (
                <MessageDetail
                  node={node()}
                  overrideMessage={overrideMessage()}
                />
              )}
            </Show>
          }
        >
          <ChartPane />
        </Show>
      </div>
    </div>
  );
}
