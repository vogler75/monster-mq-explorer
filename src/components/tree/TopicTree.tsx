import { createMemo, createSignal, For } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { useTopicTree } from "../../stores/topics";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { flattenVisibleNodes, flattenFilteredNodes, collectAllNodePaths, hasRetainedInTree, getNodeByTopic, collectRetainedTopics } from "../../lib/topic-tree";
import TopicRow from "./TopicRow";
import { tooltip } from "../ui/tooltip";

export default function TopicTree() {
  const { topicTree, clearTree, clearSubtree } = useTopicTree();
  const { expandedNodes, selectedTopic, setSelectedTopic, toggleExpanded, sortTree, toggleSort, autoExpand, toggleAutoExpand, expandAll, showRetainedOnly, toggleShowRetainedOnly, publish, connectionStatuses } =
    useUI();
  const { activeConnectionId, getConnection } = useConnections();

  const anyConnected = () => [...connectionStatuses().values()].some((s) => s === "connected");

  function clearRetainedMessages() {
    const topic = selectedTopic();
    if (!topic) return;
    const node = getNodeByTopic(topicTree, topic);
    if (!node) return;
    const connId = activeConnectionId();
    const conn = connId ? getConnection(connId) : null;
    const prefix = conn ? `${conn.name}/` : "";
    for (const t of collectRetainedTopics(node)) {
      const cleanTopic = prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t;
      publish(cleanTopic, "", 0, true);
    }
  }

  let scrollRef!: HTMLDivElement;

  const [filter, setFilter] = createSignal("");

  const flatNodes = createMemo(() => {
    const f = filter().trim();
    let nodes = f
      ? flattenFilteredNodes(topicTree, f, sortTree())
      : flattenVisibleNodes(topicTree, expandedNodes(), sortTree());
    if (showRetainedOnly()) {
      nodes = nodes.filter((n) => hasRetainedInTree(n.node));
    }
    return nodes;
  });

  const virtualizer = createVirtualizer({
    get count() {
      return flatNodes().length;
    },
    getScrollElement: () => scrollRef,
    estimateSize: () => 28,
    overscan: 20,
  });

  return (
    <div class="flex flex-col h-full">
      {/* Search filter + sort */}
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-700">
        <input
          type="text"
          placeholder="Filter topics..."
          class="flex-1 min-w-0 px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
        {/* Group 1: Tree display */}
        <button
          class="p-1 rounded shrink-0 transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": sortTree(),
            "text-slate-500 hover:text-slate-300": !sortTree(),
          }}
          onClick={toggleSort}
          use:tooltip={sortTree() ? "Sorted A-Z (click to unsort)" : "Sort A-Z"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h10M2 7h6M2 11h3" />
          </svg>
        </button>
        <button
          class="p-1 rounded shrink-0 transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": showRetainedOnly(),
            "text-slate-500 hover:text-slate-300": !showRetainedOnly(),
          }}
          onClick={toggleShowRetainedOnly}
          use:tooltip={showRetainedOnly() ? "Show all (click to show all)" : "Show retained only"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 7l2 2 4-4M12 7a5 5 0 1 0-10 0 5 5 0 0 0 10 0" />
          </svg>
        </button>

        {/* Group 2: Expand/collapse */}
        <div class="border-l border-slate-600 pl-1.5 ml-0.5 flex items-center gap-1.5">
          <button
            class="p-1 rounded shrink-0 transition-colors"
            classList={{
              "text-blue-400 bg-blue-400/10": autoExpand(),
              "text-slate-500 hover:text-slate-300": !autoExpand(),
            }}
            onClick={toggleAutoExpand}
            use:tooltip={autoExpand() ? "Auto-expand on (click to disable)" : "Auto-expand off"}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M7 2v10M2 7h10" />
            </svg>
          </button>
          <button
            class="p-1 rounded shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => {
              const sel = selectedTopic();
              if (sel) {
                const node = getNodeByTopic(topicTree, sel);
                if (node) {
                  const paths = collectAllNodePaths(node);
                  expandAll([...expandedNodes(), ...paths, sel]);
                }
              } else {
                expandAll(collectAllNodePaths(topicTree));
              }
            }}
            use:tooltip={selectedTopic() ? "Expand selected node" : "Expand all"}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 4h10M2 7h7M2 10h4" />
              <path d="M11 8l2 2-2 2" />
            </svg>
          </button>
          <button
            class="p-1 rounded shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => expandAll([])}
            use:tooltip="Collapse all"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 4h10M2 7h7M2 10h4" />
              <path d="M12 10l-2-2 2-2" />
            </svg>
          </button>
        </div>

        {/* Group 3: Selection actions */}
        <div class="border-l border-slate-600 pl-1.5 ml-0.5 flex items-center gap-1.5">
          <button
            class="p-1 rounded shrink-0 transition-colors"
            classList={{
              "text-slate-500 hover:text-slate-300 cursor-not-allowed opacity-50": !selectedTopic(),
              "text-slate-400 hover:text-slate-200": !!selectedTopic(),
            }}
            disabled={!selectedTopic()}
            onClick={() => setSelectedTopic(null)}
            use:tooltip="Deselect topic"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 4l6 6M10 4l-6 6" />
            </svg>
          </button>
          <button
            class="p-1 rounded shrink-0 transition-colors"
            classList={{
              "text-slate-500 hover:text-slate-300 cursor-not-allowed opacity-50": !selectedTopic(),
              "text-slate-400 hover:text-slate-200": selectedTopic(),
            }}
            disabled={!selectedTopic()}
            onClick={() => {
              if (selectedTopic()) {
                clearSubtree(selectedTopic()!);
                setSelectedTopic(null);
              }
            }}
            use:tooltip={selectedTopic() ? "Clear selected node and children" : "Select a node to clear"}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 3h10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3M5 1h4M5 6v4M9 6v4" />
            </svg>
          </button>
          <button
            class="p-1 rounded shrink-0 transition-colors"
            classList={{
              "text-slate-500 cursor-not-allowed opacity-50": !selectedTopic() || !anyConnected(),
              "text-orange-400 hover:text-orange-300": !!selectedTopic() && anyConnected(),
            }}
            disabled={!selectedTopic() || !anyConnected()}
            onClick={() => clearRetainedMessages()}
            use:tooltip={!selectedTopic() ? "Select a node to clear retained" : !anyConnected() ? "Connect to clear retained" : "Publish empty retained to clear broker"}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 3h10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3M5 1h4" />
              <path d="M4.5 7l2 2 3-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Virtualized tree */}
      <div ref={scrollRef!} class="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(virtualRow) => {
              const flatNode = () => flatNodes()[virtualRow.index];
              return (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TopicRow
                    node={flatNode()}
                    isSelected={selectedTopic() === flatNode()?.key}
                    onSelect={(topic) => setSelectedTopic(topic)}
                    onToggle={(topic) => toggleExpanded(topic)}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
