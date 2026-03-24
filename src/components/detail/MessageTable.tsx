import { createMemo, createSignal, createEffect, For } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { useMessageLog, type LoggedMessage } from "../../stores/messageLog";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import { payloadToString, formatTimestamp } from "../../lib/format";

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
  } = useMessageLog();
  const { topicTree } = useTopicTree();

  const [colTime, setColTime] = createSignal(100);
  const [colTopic, setColTopic] = createSignal(300);
  const [colQos, setColQos] = createSignal(36);
  const [colRetain, setColRetain] = createSignal(24);
  const [payloadMultiline, setPayloadMultiline] = createSignal(false);
  const { flashEnabled, selectedTopic } = useUI();

  let scrollRef!: HTMLDivElement;
  let multilineRef!: HTMLDivElement;

  const displayMessages = createMemo(() => {
    let msgs: LoggedMessage[];
    if (logMode() === "live") {
      msgs = Object.values(liveTopics) as LoggedMessage[];
      const order = logOrder();
      if (logSort() === "topic") {
        msgs = [...msgs].sort((a, b) =>
          order === "newest-bottom" ? a.topic.localeCompare(b.topic) : b.topic.localeCompare(a.topic)
        );
      } else {
        msgs = [...msgs].sort((a, b) =>
          order === "newest-bottom" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
        );
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

  const thBase = "relative shrink-0 px-1 flex items-center text-slate-400 font-medium select-none overflow-hidden";
  const tdBase = "shrink-0 px-1 truncate";

  return (
    <div class="flex flex-col h-full">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-2 py-1 border-b border-slate-700 bg-slate-800/60 text-xs shrink-0">
        <button
          class="p-0.5 text-slate-500 hover:text-red-400 transition-colors"
          onClick={() => { clearLog(); props.onSelectMessage(null); }}
          title="Clear log"
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
        <span class="text-slate-500">{displayMessages().length} rows</span>
        {logMode() === "history" && (
          <label class="flex items-center gap-1 ml-auto">
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

      {/* Column headers */}
      <div class="flex items-stretch h-6 border-b border-slate-700 bg-slate-800 shrink-0 text-xs">
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
        <div class={thBase + " flex-1"}>Payload</div>
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
                  return (
                    <div
                      style={{
                        position: "absolute", top: 0, left: 0, width: "100%",
                        height: `${vRow.size}px`, transform: `translateY(${vRow.start}px)`,
                      }}
                      class="flex items-center text-xs cursor-pointer border-b border-slate-800/60 hover:bg-slate-700/40 transition-colors font-mono"
                      classList={{
                        "bg-blue-600/20 hover:bg-blue-600/25": props.selectedMessageId === msg()?.id,
                        "row-updated": flashEnabled() && logMode() === "live" && recentlyUpdated().has(msg()?.topic ?? ""),
                      }}
                      onClick={() => { const m = msg(); if (m) props.onSelectMessage(props.selectedMessageId === m.id ? null : m); }}
                    >
                      <div class={tdBase + " text-slate-500"} style={{ width: `${colTime()}px` }}>{msg() ? formatTimestamp(msg()!.timestamp) : ""}</div>
                      <div class={tdBase + " text-slate-300"} style={{ width: `${colTopic()}px` }}>{msg()?.topic ?? ""}</div>
                      <div class={tdBase + " text-center text-slate-500"} style={{ width: `${colQos()}px` }}>{msg()?.qos ?? ""}</div>
                      <div class={tdBase + " text-center text-amber-500"} style={{ width: `${colRetain()}px` }}>{msg()?.retain ? "R" : ""}</div>
                      <div class="flex-1 px-1 truncate text-slate-300">{msg() ? payloadToString(msg()!.payload) : ""}</div>
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
              {(msg) => (
                <div
                  class="flex text-xs cursor-pointer border-b border-slate-800/60 hover:bg-slate-700/40 transition-colors font-mono py-1"
                  classList={{
                    "bg-blue-600/20 hover:bg-blue-600/25": props.selectedMessageId === msg.id,
                    "row-updated": flashEnabled() && logMode() === "live" && recentlyUpdated().has(msg.topic),
                  }}
                  onClick={() => props.onSelectMessage(props.selectedMessageId === msg.id ? null : msg)}
                >
                  <div class="shrink-0 px-1 text-slate-500 pt-0.5" style={{ width: `${colTime()}px` }}>{formatTimestamp(msg.timestamp)}</div>
                  <div class="shrink-0 px-1 text-slate-300 truncate pt-0.5" style={{ width: `${colTopic()}px` }}>{msg.topic}</div>
                  <div class="shrink-0 px-1 text-center text-slate-500 pt-0.5" style={{ width: `${colQos()}px` }}>{msg.qos}</div>
                  <div class="shrink-0 px-1 text-center text-amber-500 pt-0.5" style={{ width: `${colRetain()}px` }}>{msg.retain ? "R" : ""}</div>
                  <div class="flex-1 px-1 text-slate-300 whitespace-pre-wrap break-all">{payloadToString(msg.payload)}</div>
                </div>
              )}
            </For>
          </div>
        )}
      </div>
    </div>
  );
}
