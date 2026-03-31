import { For, Show, createSignal, onCleanup } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useUI } from "../../stores/ui";

interface Props {
  onClose: () => void;
  onConnect: (id: string) => void;
  onDisconnect: () => void;
}

export default function ConnectionPicker(props: Props) {
  const {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    removeConnection,
    moveConnection,
    importConnections,
    exportConnections,
    connectionImportError,
    clearConnectionImportError,
  } = useConnections();
  const { getConnectionStatus, setShowConnectionModal, setEditingConnectionId } = useUI();
  const [busy, setBusy] = createSignal(false);
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);

  async function handleImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setBusy(true);
    clearConnectionImportError();

    try {
      const text = await file.text();
      const ok = await importConnections(text);
      if (ok) props.onClose();
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  function handleExport() {
    clearConnectionImportError();
    const blob = new Blob([exportConnections()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "monster-mqtt-connections.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-connection-picker]")) props.onClose();
  }

  // Defer so the triggering click doesn't immediately close
  const timer = setTimeout(() => document.addEventListener("click", handleClickOutside), 0);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener("click", handleClickOutside);
  });

  return (
    <div
      data-connection-picker
      class="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden"
    >
      <div class="max-h-96 overflow-auto">
        <For
          each={connections}
          fallback={
            <div class="px-3 py-2 text-xs text-slate-500">No connections yet</div>
          }
        >
          {(conn, index) => (
            <div
              draggable={true}
              onDragStart={(e) => {
                setDragIndex(index());
                e.dataTransfer!.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer!.dropEffect = "move";
                setDropIndex(index());
              }}
              onDragLeave={() => {
                if (dropIndex() === index()) setDropIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex();
                if (from !== null) moveConnection(from, index());
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              class="group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-700/50 transition-colors"
              classList={{
                "bg-slate-700/70 text-slate-100": activeConnectionId() === conn.id,
                "text-slate-400": activeConnectionId() !== conn.id,
                "opacity-40": dragIndex() === index(),
                "border-b border-blue-500": dropIndex() === index() && dragIndex() !== null && dragIndex()! < index(),
                "border-t border-blue-500": dropIndex() === index() && dragIndex() !== null && dragIndex()! > index(),
              }}
              onClick={() => {
                setActiveConnectionId(conn.id);
              }}
            >
              {/* Drag handle */}
              <svg class="w-3 h-3 shrink-0 text-slate-600 cursor-grab active:cursor-grabbing" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
                <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
                <circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
              </svg>
              <div
                class="w-1.5 h-1.5 rounded-full shrink-0"
                classList={{
                  "bg-green-500": getConnectionStatus(conn.id) === "connected",
                  "bg-yellow-500 animate-pulse": getConnectionStatus(conn.id) === "connecting",
                  "bg-slate-600": getConnectionStatus(conn.id) === "disconnected",
                }}
              />
              <div class="flex-1 min-w-0">
                <div class="truncate font-medium">{conn.name}</div>
                <div class="truncate text-[10px] text-slate-500">{conn.host}:{conn.port}</div>
              </div>
              <div class="hidden group-hover:flex items-center gap-1 shrink-0">
                <button
                  class="p-0.5 text-slate-500 hover:text-slate-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingConnectionId(conn.id);
                    setShowConnectionModal(true);
                    props.onClose();
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
                  <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
                {/* Connect / Disconnect — rightmost */}
                <Show when={getConnectionStatus(conn.id) === "disconnected"}>
                  <button
                    class="p-0.5 text-green-500 hover:text-green-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveConnectionId(conn.id);
                      props.onConnect(conn.id);
                      props.onClose();
                    }}
                    title="Connect"
                  >
                    {/* Plug / power-on icon */}
                    <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M5 2v4M11 2v4M4 6h8v3a4 4 0 0 1-4 4 4 4 0 0 1-4-4V6zM8 13v2" />
                    </svg>
                  </button>
                </Show>
                <Show when={getConnectionStatus(conn.id) === "connected" || getConnectionStatus(conn.id) === "connecting"}>
                  <button
                    class="p-0.5 text-red-500 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveConnectionId(conn.id);
                      props.onDisconnect();
                    }}
                    title="Disconnect"
                  >
                    {/* Unplug / power-off icon */}
                    <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M5 2v4M11 2v4M4 6h8v3a4 4 0 0 1-4 4 4 4 0 0 1-4-4V6zM8 13v2" />
                      <path d="M2 2l12 12" stroke-width="2" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="border-t border-slate-700 p-2 space-y-2">
        <button
          class="w-full px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors text-left"
          onClick={() => {
            clearConnectionImportError();
            setEditingConnectionId(null);
            setShowConnectionModal(true);
            props.onClose();
          }}
        >
          + New Connection
        </button>
        <div class="flex gap-2">
          <label class="flex-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors text-center cursor-pointer">
            Import JSON
            <input type="file" accept="application/json,.json" class="hidden" onChange={handleImport} disabled={busy()} />
          </label>
          <button
            class="flex-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
            onClick={handleExport}
          >
            Export JSON
          </button>
        </div>
        <Show when={busy()}>
          <div class="text-[10px] text-slate-500">Importing connections...</div>
        </Show>
        <Show when={connectionImportError()}>
          {(message) => <div class="text-[10px] text-red-400">{message()}</div>}
        </Show>
      </div>
    </div>
  );
}
