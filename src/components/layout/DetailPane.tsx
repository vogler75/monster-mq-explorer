import { Show, For, createMemo, createSignal, createEffect, onMount, on, onCleanup, useContext, type Accessor, type Setter } from "solid-js";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import MessageDetail from "../detail/MessageDetail";
import MessageTable from "../detail/MessageTable";
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

  // Forward global tree selection → active tab only (ignore deselect)
  createEffect(on(globalSelectedTopic, (topic) => {
    if (topic === null) return; // deselecting in tree should not clear the tab
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

  function renameTab(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, label: trimmed } : t));
  }

  const [editingTabId, setEditingTabId] = createSignal<string | null>(null);

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-900 min-w-0">
      {/* Tab bar */}
      <div class="flex items-center bg-slate-800/60 border-b border-slate-700 shrink-0 min-h-0 overflow-x-auto">
        <For each={tabs()}>
          {(tab) => (
            <div
              class="group relative flex items-center gap-1.5 px-3 py-1 text-xs border-r border-slate-700 shrink-0 transition-colors cursor-pointer"
              classList={{
                "bg-slate-900 text-blue-400": activeTabId() === tab.id,
                "text-slate-400 hover:text-slate-200 hover:bg-slate-800": activeTabId() !== tab.id,
              }}
              onClick={() => setActiveTabId(tab.id)}
              onDblClick={(e) => { e.stopPropagation(); setEditingTabId(tab.id); }}
            >
              <Show
                when={editingTabId() === tab.id}
                fallback={<span>{tab.label}</span>}
              >
                <input
                  class="w-20 px-1 py-0 text-xs bg-slate-700 border border-blue-500 rounded text-slate-200 outline-none"
                  value={tab.label}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { renameTab(tab.id, e.currentTarget.value); setEditingTabId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { renameTab(tab.id, e.currentTarget.value); setEditingTabId(null); }
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                  ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
                />
              </Show>
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
            </div>
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
  const { ensureSeries, chartActive } = ctx.chartData;
  const { pinnedTopics } = useTabPinnedTopics();

  // This tab's own selected topic (set by parent only when this tab is active)
  const selectedTopic = ctx.selectedTopic;

  const [tableHeight, setTableHeight] = createSignal(0);
  const [detailMode, setDetailMode] = createSignal<"detail" | "chart" | "history">("detail");
  const [detailVisible, setDetailVisible] = createSignal(true);

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
      {/* Top strip */}
      <div class="flex items-center px-3 py-0.5 border-b border-slate-700 bg-slate-800/40 shrink-0 gap-2">
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
            "text-blue-400": detailVisible(),
            "text-slate-500 hover:text-slate-300": !detailVisible(),
          }}
          onClick={() => setDetailVisible((v) => !v)}
          title={detailVisible() ? "Hide detail pane" : "Show detail pane"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="1" y="2" width="12" height="10" rx="1" />
            <path d="M1 7h12" />
          </svg>
          <span>Detail</span>
        </button>
      </div>

      {/* Table pane */}
      <Show when={tableHeight() > 0}>
        <div
          class="overflow-hidden flex flex-col border-b border-slate-700"
          classList={{ "shrink-0": detailVisible(), "flex-1": !detailVisible() }}
          style={{ height: detailVisible() ? `${tableHeight()}px` : undefined }}
        >
          <MessageTable
            onSelectMessage={handleSelectMessage}
            selectedMessageId={selectedMessageId()}
          />
        </div>
        <Show when={detailVisible()}>
          <div
            class="h-1 shrink-0 cursor-row-resize bg-slate-700 hover:bg-blue-500 transition-colors"
            onMouseDown={startSplitResize}
          />
        </Show>
      </Show>

      {/* Detail pane */}
      <Show when={detailVisible()}>
        <div class="flex-1 overflow-hidden min-h-0">
          <Show
            when={selectedNode() || detailMode() === "chart" || detailMode() === "history"}
            fallback={
              <div class="h-full flex items-center justify-center text-slate-500 text-sm">
                Click a topic in the tree to view its data
              </div>
            }
          >
            <MessageDetail
              node={selectedNode() ?? undefined}
              overrideMessage={overrideMessage()}
              detailMode={detailMode()}
              onDetailModeChange={setDetailMode}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
