import { Show, createMemo } from "solid-js";
import { useUI } from "../../stores/ui";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import MessageDetail from "../detail/MessageDetail";

export default function DetailPane() {
  const { selectedTopic } = useUI();
  const { topicTree } = useTopicTree();

  const selectedNode = createMemo(() => {
    const topic = selectedTopic();
    if (!topic) return null;
    return getNodeByTopic(topicTree, topic);
  });

  return (
    <div class="flex-1 overflow-auto bg-slate-900">
      <Show
        when={selectedNode()}
        fallback={
          <div class="h-full flex items-center justify-center text-slate-500 text-sm">
            Click a topic in the tree to view its data
          </div>
        }
      >
        {(node) => <MessageDetail node={node()} />}
      </Show>
    </div>
  );
}
