import { Show, createMemo, createSignal, createEffect, onMount, on } from "solid-js";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import MessageDetail from "../detail/MessageDetail";
import MessageTable from "../detail/MessageTable";
import type { LoggedMessage } from "../../stores/messageLog";
import { useMessageLog } from "../../stores/messageLog";

export default function DetailPane() {
  const { selectedTopic } = useUI();
  const { topicTree } = useTopicTree();
  const { logEnabled, setLogEnabled, logMode, liveTopics, clearLog, seedLiveFromTree } = useMessageLog();

  const [tableHeight, setTableHeight] = createSignal(0);

  onMount(() => setTableHeight(Math.floor(containerRef.getBoundingClientRect().height / 2)));
  // In history mode: store the clicked message object directly (stable snapshot)
  const [selectedLogMsg, setSelectedLogMsg] = createSignal<LoggedMessage | null>(null);
  // In live mode: store the topic string and derive the message reactively
  const [selectedLiveTopic, setSelectedLiveTopic] = createSignal<string | null>(null);

  let containerRef!: HTMLDivElement;

  const selectedNode = createMemo(() => {
    const topic = selectedTopic();
    if (!topic) return null;
    return getNodeByTopic(topicTree, topic);
  });

  // Clear log and selection when topic changes, then seed live topics
  createEffect(on(selectedTopic, (topic) => {
    setSelectedLogMsg(null);
    setSelectedLiveTopic(null);
    clearLog();
    if (topic && logMode() === "live") {
      const node = getNodeByTopic(topicTree, topic);
      if (node) seedLiveFromTree(node);
    }
  }));

  // Clear selection when switching modes
  createEffect(() => {
    logMode();
    setSelectedLogMsg(null);
    setSelectedLiveTopic(null);
  });

  function handleSelectMessage(msg: LoggedMessage | null) {
    if (logMode() === "live") {
      setSelectedLiveTopic(msg ? msg.topic : null);
    } else {
      setSelectedLogMsg(msg);
    }
  }

  // In live mode: re-derive from the store so detail updates when a new message arrives.
  // In history mode: use the frozen snapshot clicked by the user.
  const overrideMessage = createMemo<LoggedMessage | null>(() => {
    if (logMode() === "live") {
      const topic = selectedLiveTopic();
      return topic ? (liveTopics[topic] ?? null) : null;
    }
    return selectedLogMsg();
  });

  // Row highlight id — in live mode look up the stable id from the store.
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
      {/* Table toggle strip */}
      <div class="flex items-center px-3 py-0.5 border-b border-slate-700 bg-slate-800/40 shrink-0">
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
        {/* Resize handle */}
        <div
          class="h-1 shrink-0 cursor-row-resize bg-slate-700 hover:bg-blue-500 transition-colors"
          onMouseDown={startSplitResize}
        />
      </Show>

      {/* Detail pane */}
      <div class="flex-1 overflow-auto min-h-0">
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
      </div>
    </div>
  );
}
