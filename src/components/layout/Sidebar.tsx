import { Show } from "solid-js";
import { useUI } from "../../stores/ui";
import TopicTree from "../tree/TopicTree";

export default function Sidebar() {
  const { connectionStatuses } = useUI();
  const anyConnected = () => [...connectionStatuses().values()].some((s) => s !== "disconnected");

  return (
    <div class="h-full flex flex-col border-r border-slate-700 bg-slate-850 overflow-hidden">
      <Show
        when={anyConnected()}
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
