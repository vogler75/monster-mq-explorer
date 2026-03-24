import { Show } from "solid-js";
import { useUI } from "../../stores/ui";
import ConnectionList from "../connection/ConnectionList";
import TopicTree from "../tree/TopicTree";

interface Props {
  onConnect: (id: string) => void;
}

export default function Sidebar(props: Props) {
  const { connectionStatus } = useUI();

  return (
    <div class="h-full flex flex-col border-r border-slate-700 bg-slate-850 overflow-hidden">
      {/* Connection list */}
      <ConnectionList onConnect={props.onConnect} />

      {/* Topic tree */}
      <Show
        when={connectionStatus() !== "disconnected"}
        fallback={
          <div class="flex-1 flex items-center justify-center text-sm text-slate-500 p-4 text-center">
            Select a connection and click Connect to start exploring topics
          </div>
        }
      >
        <div class="flex-1 overflow-hidden">
          <TopicTree />
        </div>
      </Show>
    </div>
  );
}
