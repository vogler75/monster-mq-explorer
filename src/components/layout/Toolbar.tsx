import { createSignal, Show } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useTopicTree } from "../../stores/topics";
import { useUI } from "../../stores/ui";
import ConnectionPicker from "../connection/ConnectionPicker";

interface Props {
  onConnect: (id: string) => void;
  onDisconnect: () => void;
}

export default function Toolbar(props: Props) {
  const { connections, activeConnectionId } = useConnections();
  const { messagesPerSecond } = useTopicTree();
  const { connectionStatus, setShowSubscriptionModal, flashEnabled, toggleFlashEnabled } = useUI();

  const [pickerOpen, setPickerOpen] = createSignal(false);

  const activeConn = () => connections.find((c) => c.id === activeConnectionId());

  return (
    <div class="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      {/* Connection picker trigger */}
      <div class="relative" data-connection-picker>
        <button
          class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700 transition-colors"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <div
            class="w-2.5 h-2.5 rounded-full shrink-0"
            classList={{
              "bg-green-500": connectionStatus() === "connected",
              "bg-yellow-500 animate-pulse": connectionStatus() === "connecting",
              "bg-slate-500": connectionStatus() === "disconnected",
            }}
          />
          <span class="text-sm font-medium text-slate-200 truncate max-w-48">
            {activeConn()?.name ?? "No connection"}
          </span>
          <svg
            class="w-3 h-3 text-slate-400 shrink-0 transition-transform"
            classList={{ "rotate-180": pickerOpen() }}
            viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"
          >
            <path d="M2 4l4 4 4-4" />
          </svg>
        </button>

        <Show when={pickerOpen()}>
          <ConnectionPicker
            onConnect={props.onConnect}
            onClose={() => setPickerOpen(false)}
          />
        </Show>
      </div>

      {/* Stats */}
      <Show when={connectionStatus() === "connected"}>
        <div class="flex items-center gap-3 text-xs text-slate-400">
          <span>{messagesPerSecond()} msg/s</span>
          <button
            class="p-0.5 rounded transition-colors"
            classList={{
              "text-blue-400 bg-blue-400/10": flashEnabled(),
              "text-slate-500 hover:text-slate-300": !flashEnabled(),
            }}
            onClick={toggleFlashEnabled}
            title={flashEnabled() ? "Flash on update (click to disable)" : "Flash on update disabled"}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M8 1L4 8h5l-3 5 7-8H8z" />
            </svg>
          </button>
        </div>
      </Show>

      {/* Actions */}
      <div class="flex items-center gap-2 ml-auto">
        <span class="text-xs text-slate-600 select-all" title="App version">v{__APP_VERSION__}</span>
        <Show when={connectionStatus() === "connected"}>
          <button
            class="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
            onClick={() => setShowSubscriptionModal(true)}
          >
            Subscriptions
          </button>
          <button
            class="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-500 rounded text-white transition-colors"
            onClick={props.onDisconnect}
          >
            Disconnect
          </button>
        </Show>
        <Show when={connectionStatus() === "disconnected" && activeConnectionId()}>
          <button
            class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
            onClick={() => props.onConnect(activeConnectionId()!)}
          >
            Connect
          </button>
        </Show>
      </div>
    </div>
  );
}
