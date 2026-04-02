import { useTopicTree } from "../../stores/topics";
import TopicTree from "../tree/TopicTree";

export default function Sidebar() {
  const { topicTree } = useTopicTree();
  const hasTopics = () => Object.keys(topicTree.children).length > 0;

  return (
    <div class="h-full flex flex-col border-r border-slate-700 bg-slate-850 overflow-hidden">
      {hasTopics() ? (
        <div class="flex-1 overflow-hidden">
          <TopicTree />
        </div>
      ) : (
        <div class="flex-1 flex items-center justify-center text-sm text-slate-500 p-4 text-center">
          Select a connection and click Connect to start exploring topics
        </div>
      )}
    </div>
  );
}
