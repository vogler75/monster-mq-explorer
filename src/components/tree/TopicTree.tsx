import { createMemo, createSignal, For } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { useTopicTree } from "../../stores/topics";
import { useUI } from "../../stores/ui";
import { flattenVisibleNodes } from "../../lib/topic-tree";
import TopicRow from "./TopicRow";

export default function TopicTree() {
  const { topicTree } = useTopicTree();
  const { expandedNodes, selectedTopic, setSelectedTopic, toggleExpanded, sortTree, toggleSort } =
    useUI();

  let scrollRef!: HTMLDivElement;

  const [filter, setFilter] = createSignal("");

  const flatNodes = createMemo(() => {
    const nodes = flattenVisibleNodes(topicTree, expandedNodes(), sortTree());
    const f = filter().toLowerCase();
    if (!f) return nodes;
    return nodes.filter((n) => n.key.toLowerCase().includes(f));
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
        <button
          class="p-1 rounded shrink-0 transition-colors"
          classList={{
            "text-blue-400 bg-blue-400/10": sortTree(),
            "text-slate-500 hover:text-slate-300": !sortTree(),
          }}
          onClick={toggleSort}
          title={sortTree() ? "Sorted A-Z (click to unsort)" : "Sort A-Z"}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h10M2 7h6M2 11h3" />
          </svg>
        </button>
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
