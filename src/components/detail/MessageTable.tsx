import { createMemo, createSignal, createEffect, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { useTabMessageLog, useTabPinnedTopics, useTabSelectedTopic } from "../../stores/tabStore";
import type { LoggedMessage } from "../../stores/messageLog";
import { useWatchlist } from "../../stores/watchlist";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import { payloadToString, formatTimestamp } from "../../lib/format";

function parseJsonObject(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payloadToString(payload));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* not JSON */ }
  return null;
}

function formatJsonCell(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface Props {
  onSelectMessage: (msg: LoggedMessage | null) => void;
  selectedMessageId: number | null;
}

function startColResize(
  e: MouseEvent,
  getter: () => number,
  setter: (v: number) => void,
  minWidth = 30
) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = getter();
  function onMove(ev: MouseEvent) {
    setter(Math.max(minWidth, startW + ev.clientX - startX));
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

export default function MessageTable(props: Props) {
  const {
    logEnabled, setLogEnabled,
    logMode, setLogMode,
    logMaxRows, setLogMaxRows,
    logAutoScroll, setLogAutoScroll,
    logOrder, setLogOrder,
    logSort, setLogSort,
    logMessages, liveTopics, recentlyUpdated, clearLog, seedLiveFromTree,
  } = useTabMessageLog();
  const { pinnedTopics, isPinned, pinTopics, unpinTopics, clearPinned } = useTabPinnedTopics();
  const { watchlists, saveWatchlist, getWatchlistTopics, deleteWatchlist } = useWatchlist();
  const { topicTree } = useTopicTree();

  const [colTime, setColTime] = createSignal(100);
  const [colTopic, setColTopic] = createSignal(300);
  const [colQos, setColQos] = createSignal(36);
  const [colRetain, setColRetain] = createSignal(24);
  const [payloadMultiline, setPayloadMultiline] = createSignal(false);
  const [jsonColumnsEnabled, setJsonColumnsEnabled] = createSignal(false);
  const [jsonColWidths, setJsonColWidths] = createStore<Record<string, number>>({});

  // Filter
  const [topicFilter, setTopicFilter] = createSignal("");

  // Watchlist UI state
  const [showWatchlistMenu, setShowWatchlistMenu] = createSignal(false);
  const [saveNameInput, setSaveNameInput] = createSignal("");
  const [showSaveInput, setShowSaveInput] = createSignal(false);

  const parsedPayloads = createMemo(() => {
    if (!jsonColumnsEnabled()) return [] as (Record<string, unknown> | null)[];
    return displayMessages().map((msg) => parseJsonObject(msg.payload));
  });

  const jsonKeys = createMemo(() => {
    if (!jsonColumnsEnabled()) return [] as string[];
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const parsed of parsedPayloads()) {
      if (!parsed) continue;
      for (const k of Object.keys(parsed)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
    }
    return keys;
  });
  const { flashEnabled } = useUI();
  const selectedTopic = useTabSelectedTopic();

  let scrollRef!: HTMLDivElement;
  let multilineRef!: HTMLDivElement;

  const displayMessages = createMemo(() => {
    const pinned = pinnedTopics();
    let msgs: LoggedMessage[];
    if (logMode() === "live") {
      msgs = Object.values(liveTopics) as LoggedMessage[];
      const order = logOrder();
      if (logSort() === "topic") {
        msgs = [...msgs].sort((a, b) => {
          const pa = pinned.has(a.topic), pb = pinned.has(b.topic);
          if (pa !== pb) return pa ? -1 : 1;
          return order === "newest-bottom" ? a.topic.localeCompare(b.topic) : b.topic.localeCompare(a.topic);
        });
      } else {
        msgs = [...msgs].sort((a, b) => {
          const pa = pinned.has(a.topic), pb = pinned.has(b.topic);
          if (pa !== pb) return pa ? -1 : 1;
          return order === "newest-bottom" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
        });
      }
    } else {
      msgs = logMessages as LoggedMessage[];
      if (logSort() === "topic") {
        msgs = [...msgs].sort((a, b) =>
          logOrder() === "newest-bottom" ? a.topic.localeCompare(b.topic) : b.topic.localeCompare(a.topic)
        );
      } else {
        msgs = logOrder() === "newest-top" ? [...msgs].reverse() : msgs;
      }
    }
    // Apply topic filter
    const filter = topicFilter().toLowerCase();
    if (filter) {
      msgs = msgs.filter((m) => m.topic.toLowerCase().includes(filter));
    }
    return msgs;
  });

  const virtualizer = createVirtualizer({
    get count() { return displayMessages().length; },
    getScrollElement: () => scrollRef,
    estimateSize: () => 28,
    overscan: 10,
  });

  // Auto-scroll (virtualized mode)
  createEffect(() => {
    const count = displayMessages().length;
    if (count === 0 || !logAutoScroll() || payloadMultiline() || logMode() === "live") return;
    queueMicrotask(() => {
      virtualizer.scrollToIndex(
        logOrder() === "newest-top" ? 0 : count - 1,
        { align: "end" }
      );
    });
  });

  // Auto-scroll (multiline mode)
  createEffect(() => {
    displayMessages().length; // track
    if (!logAutoScroll() || !payloadMultiline() || logMode() === "live") return;
    queueMicrotask(() => {
      if (!multilineRef) return;
      if (logOrder() === "newest-top") {
        multilineRef.scrollTop = 0;
      } else {
        multilineRef.scrollTop = multilineRef.scrollHeight;
      }
    });
  });

  function trimTopic(topic: string): string {
    if (isPinned(topic)) return topic;
    const prefix = selectedTopic();
    if (!prefix) return topic;
    if (topic === prefix) return ".";
    if (topic.startsWith(prefix + "/")) return topic.slice(prefix.length + 1);
    return topic;
  }

  // ---- Pin column shift-click range tracking ----
  let lastPinClickedIdx = -1;
  let lastPinClickedAdded = true;

  function handlePinClick(e: MouseEvent, index: number) {
    e.stopPropagation(); // don't also trigger the row's detail-select
    const msgs = displayMessages();
    const topic = msgs[index]?.topic;
    if (!topic) return;

    if (e.shiftKey && lastPinClickedIdx !== -1) {
      const from = Math.min(lastPinClickedIdx, index);
      const to = Math.max(lastPinClickedIdx, index);
      const topics = msgs.slice(from, to + 1).map((m) => m.topic);
      if (lastPinClickedAdded) pinTopics(topics); else unpinTopics(topics);
    } else {
      const wasPin = isPinned(topic);
      if (wasPin) unpinTopics([topic]); else pinTopics([topic]);
      lastPinClickedIdx = index;
      lastPinClickedAdded = !wasPin;
    }
  }

  function pinSelected() {
    // Pin all currently visible rows
    pinTopics(displayMessages().map((m) => m.topic));
  }

  function unpinSelected() {
    clearPinned();
  }

  const hasPinned = () => pinnedTopics().size > 0;

  const thBase = "relative shrink-0 px-1 flex items-center text-slate-400 font-medium select-none overflow-hidden";
  const tdBase = "shrink-0 px-1 truncate";

  return (
    <div class="flex flex-col h-full">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-2 py-1 border-b border-slate-700 bg-slate-800/60 text-xs shrink-0 flex-wrap">
        <button
          class="p-0.5 text-slate-500 hover:text-red-400 transition-colors"
          onClick={() => { clearLog(pinnedTopics()); props.onSelectMessage(null); }}
          title="Clear log (keeps pinned rows)"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3M5 1h4M5 6v4M9 6v4" />
          </svg>
        </button>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            class="accent-blue-500"
            checked={logEnabled()}
            onChange={(e) => setLogEnabled(e.currentTarget.checked)}
          />
          <span class="text-slate-300">Active</span>
        </label>
        {/* Mode toggle */}
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": logMode() === "live",
            "text-slate-500 hover:text-slate-300": logMode() === "history",
          }}
          onClick={() => {
            const next = logMode() === "history" ? "live" : "history";
            setLogMode(next);
            setLogSort(next === "live" ? "topic" : "time");
            if (next === "live") {
              const topic = selectedTopic();
              if (topic) {
                const node = getNodeByTopic(topicTree, topic);
                if (node) seedLiveFromTree(node);
              }
            }
          }}
          title={logMode() === "live" ? "Live view: one row per topic (click for history)" : "History view: all messages (click for live)"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="7" cy="7" r="2" />
            <path d="M7 1v2M7 11v2M1 7h2M11 7h2" />
          </svg>
        </button>
        {/* Sort toggle */}
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": logSort() === "topic",
            "text-slate-500 hover:text-slate-300": logSort() === "time",
          }}
          onClick={() => setLogSort((s) => s === "time" ? "topic" : "time")}
          title={logSort() === "topic" ? "Sorted by topic (click for time)" : "Sorted by time (click for topic)"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            {logSort() === "topic"
              ? <path d="M2 3h10M2 7h6M2 11h3" />
              : <path d="M2 3h5M2 7h4M2 11h3M10 2v9M8 9l2 2 2-2" />}
          </svg>
        </button>
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": logAutoScroll(),
            "text-slate-500 hover:text-slate-300": !logAutoScroll(),
          }}
          onClick={() => setLogAutoScroll((v) => !v)}
          title={logAutoScroll() ? "Auto-scroll on" : "Auto-scroll off"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 2v8M4 7l3 3 3-3M2 12h10" />
          </svg>
        </button>
        <button
          class="p-0.5 rounded text-slate-400 hover:text-slate-200 transition-colors"
          onClick={() => setLogOrder((o) => o === "newest-top" ? "newest-bottom" : "newest-top")}
          title={logOrder() === "newest-top"
            ? (logSort() === "topic" ? "Z-A (click for A-Z)" : "Newest on top (click for bottom)")
            : (logSort() === "topic" ? "A-Z (click for Z-A)" : "Newest on bottom (click for top)")}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            {logOrder() === "newest-top"
              ? <path d="M7 12V4M4 7l3-3 3 3" />
              : <path d="M7 2v8M4 7l3 3 3-3" />}
          </svg>
        </button>
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": payloadMultiline(),
            "text-slate-500 hover:text-slate-300": !payloadMultiline(),
          }}
          onClick={() => setPayloadMultiline((v) => !v)}
          title={payloadMultiline() ? "Payload: full text (click for single line)" : "Payload: single line (click for full text)"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h10M2 6h10M2 9h6" />
          </svg>
        </button>
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": jsonColumnsEnabled(),
            "text-slate-500 hover:text-slate-300": !jsonColumnsEnabled(),
          }}
          onClick={() => setJsonColumnsEnabled((v) => !v)}
          title={jsonColumnsEnabled() ? "JSON columns on (click to disable)" : "JSON columns off (click to expand JSON keys as columns)"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 2h3v10H2M9 2h3v10H9M5 7h4" />
          </svg>
        </button>

        {/* Divider */}
        <div class="w-px h-3.5 bg-slate-600 shrink-0" />

        {/* Pin selected rows */}
        <button
          class="p-0.5 rounded transition-colors"
          classList={{
            "text-amber-400 bg-amber-400/10": hasPinned(),
            "text-slate-500 hover:text-amber-400": !hasPinned(),
          }}
          onClick={pinSelected}
          title="Sticky all visible rows"
        >
          {/* Pin icon */}
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 1L13 5L9.5 8.5L10 13L7 10L4 13L4.5 8.5L1 5L5 1Z" />
          </svg>
        </button>

        {/* Unpin button — only shown when there are pinned rows */}
        <Show when={hasPinned()}>
          <button
            class="p-0.5 rounded text-amber-500 hover:text-red-400 transition-colors"
            onClick={unpinSelected}
            title="Unpin all rows"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M9 1L13 5L9.5 8.5L10 13L7 10L4 13L4.5 8.5L1 5L5 1Z" />
              <line x1="1" y1="1" x2="13" y2="13" />
            </svg>
          </button>
        </Show>

        {/* Watchlist menu */}
        <div class="relative">
          <button
            class="p-0.5 rounded transition-colors"
            classList={{
              "text-blue-400 bg-blue-400/10": showWatchlistMenu(),
              "text-slate-500 hover:text-slate-300": !showWatchlistMenu(),
            }}
            onClick={() => { setShowWatchlistMenu((v) => !v); setShowSaveInput(false); }}
            title="Watchlists (save/load sticky rows)"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 2h10v10H2zM2 5h10M5 5v7" />
            </svg>
          </button>

          <Show when={showWatchlistMenu()}>
            {/* Backdrop */}
            <div class="fixed inset-0 z-40" onClick={() => { setShowWatchlistMenu(false); setShowSaveInput(false); }} />
            <div class="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-xl min-w-[220px]">
              {/* Save current pinned set */}
              <Show
                when={showSaveInput()}
                fallback={
                  <button
                    class="w-full text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 rounded-t"
                    disabled={!hasPinned()}
                    classList={{ "opacity-40 cursor-not-allowed": !hasPinned() }}
                    onClick={() => { if (hasPinned()) setShowSaveInput(true); }}
                  >
                    Save sticky rows as watchlist…
                  </button>
                }
              >
                <div class="px-2 py-1.5 flex gap-1">
                  <input
                    class="flex-1 px-1.5 py-0.5 text-xs bg-slate-700 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500"
                    placeholder="Watchlist name"
                    value={saveNameInput()}
                    onInput={(e) => setSaveNameInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && saveNameInput().trim()) {
                        saveWatchlist(saveNameInput().trim(), pinnedTopics());
                        setSaveNameInput("");
                        setShowSaveInput(false);
                        setShowWatchlistMenu(false);
                      } else if (e.key === "Escape") {
                        setShowSaveInput(false);
                      }
                    }}
                    ref={(el) => requestAnimationFrame(() => el?.focus())}
                  />
                  <button
                    class="px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                    disabled={!saveNameInput().trim()}
                    onClick={() => {
                      if (saveNameInput().trim()) {
                        saveWatchlist(saveNameInput().trim(), pinnedTopics());
                        setSaveNameInput("");
                        setShowSaveInput(false);
                        setShowWatchlistMenu(false);
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </Show>

              {/* Saved watchlists */}
              <Show
                when={watchlists.length > 0}
                fallback={
                  <div class="px-3 py-2 text-xs text-slate-500 border-t border-slate-700">No saved watchlists</div>
                }
              >
                <div class="border-t border-slate-700">
                  <For each={watchlists}>
                    {(wl) => (
                      <div class="flex items-center gap-1 px-2 py-1 hover:bg-slate-700 group">
                        <button
                          class="flex-1 text-left text-xs text-slate-300 group-hover:text-slate-100 truncate"
                          onClick={() => { pinTopics(getWatchlistTopics(wl.id)); setShowWatchlistMenu(false); }}
                          title={`Load "${wl.name}" (${wl.topics.length} topics)`}
                        >
                          {wl.name}
                          <span class="ml-1.5 text-slate-500">{wl.topics.length}</span>
                        </button>
                        <button
                          class="p-0.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => deleteWatchlist(wl.id)}
                          title="Delete watchlist"
                        >
                          <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M2 2l8 8M10 2l-8 8" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <span class="text-slate-500">
          {displayMessages().length} rows
          {hasPinned() && <span class="ml-1 text-amber-500">{pinnedTopics().size} sticky</span>}
        </span>

        <div class="flex items-center gap-1 ml-auto">
          {/* Topic filter */}
          <div class="relative">
            <input
              type="text"
              placeholder="Filter…"
              value={topicFilter()}
              onInput={(e) => setTopicFilter(e.currentTarget.value)}
              class="w-28 px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 text-xs outline-none focus:border-blue-500 focus:w-40 transition-all placeholder-slate-500"
            />
            <Show when={topicFilter()}>
              <button
                class="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                onClick={() => setTopicFilter("")}
              >
                <svg class="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            </Show>
          </div>
          {logMode() === "history" && (
            <label class="flex items-center gap-1">
              <span class="text-slate-500">Max</span>
              <input
                type="number"
                class="w-16 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500"
                value={logMaxRows()}
                onBlur={(e) => setLogMaxRows(Math.max(10, parseInt(e.currentTarget.value) || 500))}
              />
            </label>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div class="flex items-stretch h-6 border-b border-slate-700 bg-slate-800 shrink-0 text-xs">
        {/* Small pin indicator column */}
        <div class="w-4 shrink-0" />
        <div class={thBase} style={{ width: `${colTime()}px` }}>
          Time
          <div
            class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10"
            onMouseDown={(e) => startColResize(e, colTime, setColTime, 50)}
          />
        </div>
        <div class={thBase} style={{ width: `${colTopic()}px` }}>
          Topic
          <div
            class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10"
            onMouseDown={(e) => startColResize(e, colTopic, setColTopic, 60)}
          />
        </div>
        <div class={thBase + " justify-center"} style={{ width: `${colQos()}px` }}>
          Q
          <div
            class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10"
            onMouseDown={(e) => startColResize(e, colQos, setColQos, 24)}
          />
        </div>
        <div class={thBase + " justify-center"} style={{ width: `${colRetain()}px` }}>
          R
          <div
            class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10"
            onMouseDown={(e) => startColResize(e, colRetain, setColRetain, 20)}
          />
        </div>
        {jsonColumnsEnabled()
          ? <For each={jsonKeys()}>{(key) => (
              <div class={thBase} style={{ width: `${jsonColWidths[key] ?? 100}px` }}>
                {key}
                <div
                  class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10"
                  onMouseDown={(e) => startColResize(e, () => jsonColWidths[key] ?? 100, (v) => setJsonColWidths(key, v), 40)}
                />
              </div>
            )}</For>
          : <div class={thBase + " flex-1"}>Payload</div>
        }
      </div>

      {/* Table body */}
      <div class="relative flex-1 overflow-hidden">

        {/* Single-line mode: virtualized, fixed row height */}
        {!payloadMultiline() && (
          <div ref={scrollRef!} class="h-full overflow-auto">
            <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
              <For each={virtualizer.getVirtualItems()}>
                {(vRow) => {
                  const msg = () => displayMessages()[vRow.index];
                  const pinned = () => msg() ? isPinned(msg()!.topic) : false;
                  return (
                    <div
                      style={{
                        position: "absolute", top: 0, left: 0, width: "100%",
                        height: `${vRow.size}px`, transform: `translateY(${vRow.start}px)`,
                      }}
                      class="flex items-center text-xs cursor-pointer border-b border-slate-800/60 hover:bg-slate-700/40 transition-colors font-mono"
                      classList={{
                        "bg-blue-600/20 hover:bg-blue-600/25": props.selectedMessageId === msg()?.id,
                        "bg-amber-500/10": pinned() && props.selectedMessageId !== msg()?.id,
                        "row-updated": flashEnabled() && logMode() === "live" && recentlyUpdated().has(msg()?.topic ?? ""),
                      }}
                      onClick={() => { const m = msg(); if (m) props.onSelectMessage(props.selectedMessageId === m.id ? null : m); }}
                    >
                      {/* Pin toggle cell — click to sticky/unsticky, shift+click for range */}
                      <div
                        class="w-4 shrink-0 flex items-center justify-center hover:bg-slate-600/60 self-stretch cursor-pointer"
                        onClick={(e) => handlePinClick(e, vRow.index)}
                        title={pinned() ? "Unsticky" : "Sticky"}
                      >
                        <Show when={pinned()} fallback={
                          <svg class="w-2.5 h-2.5 text-slate-600 opacity-0 group-hover:opacity-100" viewBox="0 0 14 14" fill="currentColor">
                            <path d="M9 1L13 5L9.5 8.5L10 13L7 10L4 13L4.5 8.5L1 5L5 1Z" />
                          </svg>
                        }>
                          <svg class="w-2.5 h-2.5 text-amber-400" viewBox="0 0 14 14" fill="currentColor">
                            <path d="M9 1L13 5L9.5 8.5L10 13L7 10L4 13L4.5 8.5L1 5L5 1Z" />
                          </svg>
                        </Show>
                      </div>
                      <div class={tdBase + " text-slate-500"} style={{ width: `${colTime()}px` }}>{msg() ? formatTimestamp(msg()!.timestamp) : ""}</div>
                      <div class={tdBase + " text-slate-300"} style={{ width: `${colTopic()}px` }}>{msg() ? trimTopic(msg()!.topic) : ""}</div>
                      <div class={tdBase + " text-center text-slate-500"} style={{ width: `${colQos()}px` }}>{msg()?.qos ?? ""}</div>
                      <div class={tdBase + " text-center text-amber-500"} style={{ width: `${colRetain()}px` }}>{msg()?.retain ? "R" : ""}</div>
                      {jsonColumnsEnabled()
                        ? <For each={jsonKeys()}>{(key) => {
                            const val = () => parsedPayloads()[vRow.index]?.[key];
                            return <div class={tdBase + " text-slate-300"} style={{ width: `${jsonColWidths[key] ?? 100}px` }}>{formatJsonCell(val())}</div>;
                          }}</For>
                        : <div class="flex-1 px-1 truncate text-slate-300">{msg() ? payloadToString(msg()!.payload) : ""}</div>
                      }
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}

        {/* Multi-line mode: plain scroll, auto row height */}
        {payloadMultiline() && (
          <div ref={multilineRef!} class="h-full overflow-auto">
            <For each={displayMessages()}>
              {(msg, i) => {
                const pinned = () => isPinned(msg.topic);
                return (
                  <div
                    class="flex text-xs cursor-pointer border-b border-slate-800/60 hover:bg-slate-700/40 transition-colors font-mono py-1"
                    classList={{
                      "bg-blue-600/20 hover:bg-blue-600/25": props.selectedMessageId === msg.id,
                      "bg-amber-500/10": pinned() && props.selectedMessageId !== msg.id,
                      "row-updated": flashEnabled() && logMode() === "live" && recentlyUpdated().has(msg.topic),
                    }}
                    onClick={() => props.onSelectMessage(props.selectedMessageId === msg.id ? null : msg)}
                  >
                    {/* Pin toggle cell */}
                    <div
                      class="w-4 shrink-0 flex items-center justify-center hover:bg-slate-600/60 self-stretch cursor-pointer"
                      onClick={(e) => handlePinClick(e, i())}
                      title={pinned() ? "Unsticky" : "Sticky"}
                    >
                      <Show when={pinned()}>
                        <svg class="w-2.5 h-2.5 text-amber-400 mt-0.5" viewBox="0 0 14 14" fill="currentColor">
                          <path d="M9 1L13 5L9.5 8.5L10 13L7 10L4 13L4.5 8.5L1 5L5 1Z" />
                        </svg>
                      </Show>
                    </div>
                    <div class="shrink-0 px-1 text-slate-500 pt-0.5" style={{ width: `${colTime()}px` }}>{formatTimestamp(msg.timestamp)}</div>
                    <div class="shrink-0 px-1 text-slate-300 truncate pt-0.5" style={{ width: `${colTopic()}px` }}>{trimTopic(msg.topic)}</div>
                    <div class="shrink-0 px-1 text-center text-slate-500 pt-0.5" style={{ width: `${colQos()}px` }}>{msg.qos}</div>
                    <div class="shrink-0 px-1 text-center text-amber-500 pt-0.5" style={{ width: `${colRetain()}px` }}>{msg.retain ? "R" : ""}</div>
                    {jsonColumnsEnabled()
                      ? (() => { const parsed = parseJsonObject(msg.payload); return (
                          <For each={jsonKeys()}>{(key) => (
                            <div class="shrink-0 px-1 text-slate-300 truncate pt-0.5" style={{ width: `${jsonColWidths[key] ?? 100}px` }}>{formatJsonCell(parsed?.[key])}</div>
                          )}</For>
                        ); })()
                      : <div class="flex-1 px-1 text-slate-300 whitespace-pre-wrap break-all">{payloadToString(msg.payload)}</div>
                    }
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </div>
    </div>
  );
}
