import { For, Show } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useUI } from "../../stores/ui";

export default function ConnectionList() {
  const { connections, activeConnectionId, setActiveConnectionId, removeConnection } =
    useConnections();
  const { getConnectionStatus, setShowConnectionModal, setEditingConnectionId } =
    useUI();

  return (
    <div class="border-b border-slate-700">
      <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Connections
      </div>
      <div class="max-h-40 overflow-auto">
        <For
          each={connections}
          fallback={
            <div class="px-3 py-2 text-xs text-slate-500">
              No connections yet
            </div>
          }
        >
          {(conn) => (
            <div
              class="group flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-700/50 transition-colors"
              classList={{
                "bg-slate-700/70 text-slate-100":
                  activeConnectionId() === conn.id,
                "text-slate-400": activeConnectionId() !== conn.id,
              }}
              onClick={() => {
                setActiveConnectionId(conn.id);
              }}
            >
              <div
                class="w-1.5 h-1.5 rounded-full shrink-0"
                classList={{
                  "bg-green-500": getConnectionStatus(conn.id) === "connected",
                  "bg-yellow-500 animate-pulse": getConnectionStatus(conn.id) === "connecting",
                  "bg-slate-600": getConnectionStatus(conn.id) === "disconnected",
                }}
              />
              <span class="truncate">{conn.name}</span>
              <span class="ml-auto text-[10px] text-slate-600 truncate">
                {conn.host}:{conn.port}
              </span>

              {/* Edit/delete on hover */}
              <div class="hidden group-hover:flex items-center gap-1 shrink-0">
                <button
                  class="p-0.5 text-slate-500 hover:text-slate-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingConnectionId(conn.id);
                    setShowConnectionModal(true);
                  }}
                  title="Edit"
                >
                  <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M9.5 1.5l1 1-7 7H2v-1.5l7-7z" />
                  </svg>
                </button>
                <button
                  class="p-0.5 text-slate-500 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConnection(conn.id);
                  }}
                  title="Delete"
                >
                  <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" fill="none" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
