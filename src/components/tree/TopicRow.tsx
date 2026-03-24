import { createEffect, createSignal, Show } from "solid-js";
import type { FlatTreeNode } from "../../types/mqtt";

interface Props {
  node: FlatTreeNode | undefined;
  isSelected: boolean;
  onSelect: (topic: string) => void;
  onToggle: (topic: string) => void;
}

export default function TopicRow(props: Props) {
  const [flash, setFlash] = createSignal(false);

  // Flash on update
  let lastUpdated = 0;
  createEffect(() => {
    const node = props.node;
    if (!node) return;
    const ts = node.node.lastUpdated;
    if (ts > lastUpdated && lastUpdated > 0) {
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
    }
    lastUpdated = ts;
  });

  return (
    <Show when={props.node}>
      {(flatNode) => (
        <div
          class="flex items-center h-7 px-1 cursor-pointer select-none text-xs hover:bg-slate-700/50 transition-colors"
          classList={{
            "bg-blue-600/20 text-blue-200": props.isSelected,
            "text-slate-300": !props.isSelected,
            "row-updated": flash(),
          }}
          style={{ "padding-left": `${flatNode().depth * 16 + 4}px` }}
          onClick={() => props.onSelect(flatNode().key)}
        >
          {/* Expand/collapse chevron */}
          <span
            class="w-4 h-4 flex items-center justify-center shrink-0 text-slate-500"
            classList={{ invisible: !flatNode().hasChildren }}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(flatNode().key);
            }}
          >
            <svg
              class="w-3 h-3 transition-transform"
              classList={{ "rotate-90": flatNode().isExpanded }}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M4 2l4 4-4 4z" />
            </svg>
          </span>

          {/* Topic segment name */}
          <span class="truncate ml-1">{flatNode().node.segment}</span>

          {/* Message count badge */}
          <Show when={flatNode().node.messageCount > 0}>
            <span class="ml-auto px-1.5 py-0.5 text-[10px] bg-slate-700 text-slate-400 rounded-full shrink-0">
              {flatNode().node.messageCount}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
