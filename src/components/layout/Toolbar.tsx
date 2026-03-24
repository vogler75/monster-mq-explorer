import { Show } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useTopicTree } from "../../stores/topics";
import { useUI } from "../../stores/ui";

interface Props {
  onConnect: (id: string) => void;
  onDisconnect: () => void;
}

export default function Toolbar(props: Props) {
  const { connections, activeConnectionId } = useConnections();
  const { totalMessages, messagesPerSecond } = useTopicTree();
  const { connectionStatus, setShowConnectionModal, setEditingConnectionId } = useUI();

  const activeConn = () =>
    connections.find((c) => c.id === activeConnectionId());

  return (
    <div class="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      {/* Status indicator */}
      <div
        class="w-2.5 h-2.5 rounded-full shrink-0"
        classList={{
          "bg-green-500": connectionStatus() === "connected",
          "bg-yellow-500 animate-pulse": connectionStatus() === "connecting",
          "bg-slate-500": connectionStatus() === "disconnected",
        }}
      />

      {/* Connection name */}
      <span class="text-sm font-medium text-slate-200 truncate">
        {activeConn()?.name ?? "No connection"}
      </span>

      {/* Stats */}
      <Show when={connectionStatus() === "connected"}>
        <div class="flex items-center gap-3 ml-auto text-xs text-slate-400">
          <span>{totalMessages().toLocaleString()} msgs</span>
          <span>{messagesPerSecond()} msg/s</span>
        </div>
      </Show>

      {/* Actions */}
      <div class="flex items-center gap-2 ml-auto">
        <Show
          when={connectionStatus() === "connected"}
          fallback={
            <Show when={activeConnectionId()}>
              <button
                class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
                onClick={() => props.onConnect(activeConnectionId()!)}
              >
                Connect
              </button>
            </Show>
          }
        >
          <button
            class="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-500 rounded text-white transition-colors"
            onClick={() => props.onDisconnect()}
          >
            Disconnect
          </button>
        </Show>
        <button
          class="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          onClick={() => {
            setEditingConnectionId(null);
            setShowConnectionModal(true);
          }}
        >
          + Connection
        </button>
      </div>
    </div>
  );
}
