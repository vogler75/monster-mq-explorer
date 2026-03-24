import { createSignal, createEffect, For, Show } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useUI } from "../../stores/ui";
import type { ConnectionConfig, Subscription } from "../../types/mqtt";
import { createDefaultConnection } from "../../types/mqtt";

export default function ConnectionModal() {
  const { addConnection, updateConnection, getConnection } = useConnections();
  const { setShowConnectionModal, editingConnectionId } = useUI();

  const isEditing = () => editingConnectionId() !== null;
  const existing = () =>
    editingConnectionId() ? getConnection(editingConnectionId()!) : null;

  const defaults = () => existing() ?? createDefaultConnection();

  const [name, setName] = createSignal(defaults().name);
  const [host, setHost] = createSignal(defaults().host);
  const [port, setPort] = createSignal(defaults().port);
  const [protocol, setProtocol] = createSignal(defaults().protocol);
  const [path, setPath] = createSignal(defaults().path);
  const [username, setUsername] = createSignal(defaults().username);
  const [password, setPassword] = createSignal(defaults().password);
  const [clientId, setClientId] = createSignal(defaults().clientId);
  const [subscriptions, setSubscriptions] = createSignal<Subscription[]>([
    ...defaults().subscriptions,
  ]);

  function addSub() {
    setSubscriptions([...subscriptions(), { topic: "", qos: 0 }]);
  }

  function removeSub(index: number) {
    setSubscriptions(subscriptions().filter((_, i) => i !== index));
  }

  function updateSub(index: number, field: keyof Subscription, value: string | number) {
    setSubscriptions(
      subscriptions().map((s, i) =>
        i === index ? { ...s, [field]: value } : s
      )
    );
  }

  function handleSave() {
    const config: Partial<ConnectionConfig> = {
      name: name(),
      host: host(),
      port: port(),
      protocol: protocol(),
      path: path(),
      username: username(),
      password: password(),
      clientId: clientId(),
      subscriptions: subscriptions().filter((s) => s.topic.trim() !== ""),
    };

    if (isEditing()) {
      updateConnection(editingConnectionId()!, config);
    } else {
      addConnection(config);
    }
    setShowConnectionModal(false);
  }

  function handleClose() {
    setShowConnectionModal(false);
  }

  const inputBase =
    "px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500";
  const inputClass = "w-full " + inputBase;
  const labelClass = "block text-xs text-slate-400 mb-1";

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg w-[480px] max-h-[90vh] overflow-auto shadow-xl">
        <div class="px-4 py-3 border-b border-slate-700">
          <h2 class="text-sm font-semibold text-slate-200">
            {isEditing() ? "Edit Connection" : "New Connection"}
          </h2>
        </div>

        <div class="p-4 space-y-3">
          {/* Name */}
          <div>
            <label class={labelClass}>Connection Name</label>
            <input
              class={inputClass}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>

          {/* Host + Port + Protocol */}
          <div class="grid grid-cols-[1fr_80px_80px] gap-2">
            <div>
              <label class={labelClass}>Host</label>
              <input
                class={inputClass}
                value={host()}
                onInput={(e) => setHost(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class={labelClass}>Port</label>
              <input
                class={inputClass}
                type="number"
                value={port()}
                onInput={(e) => setPort(parseInt(e.currentTarget.value) || 0)}
              />
            </div>
            <div>
              <label class={labelClass}>Protocol</label>
              <select
                class={inputClass}
                value={protocol()}
                onChange={(e) =>
                  setProtocol(e.currentTarget.value as "ws" | "wss")
                }
              >
                <option value="wss">wss</option>
                <option value="ws">ws</option>
              </select>
            </div>
          </div>

          {/* Path */}
          <div>
            <label class={labelClass}>WebSocket Path</label>
            <input
              class={inputClass}
              value={path()}
              onInput={(e) => setPath(e.currentTarget.value)}
            />
          </div>

          {/* Username + Password */}
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class={labelClass}>Username</label>
              <input
                class={inputClass}
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class={labelClass}>Password</label>
              <input
                class={inputClass}
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
          </div>

          {/* Client ID */}
          <div>
            <label class={labelClass}>Client ID</label>
            <input
              class={inputClass}
              value={clientId()}
              onInput={(e) => setClientId(e.currentTarget.value)}
            />
          </div>

          {/* Subscriptions */}
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class={labelClass + " mb-0"}>Subscriptions</label>
              <button
                class="text-xs text-blue-400 hover:text-blue-300"
                onClick={addSub}
              >
                + Add
              </button>
            </div>
            <div class="space-y-1.5">
              <For each={subscriptions()}>
                {(sub, index) => (
                  <div class="flex gap-2 items-center">
                    <input
                      class={inputBase + " min-w-0 flex-1"}
                      placeholder="topic/path/#"
                      value={sub.topic}
                      onInput={(e) =>
                        updateSub(index(), "topic", e.currentTarget.value)
                      }
                    />
                    <select
                      class={inputBase + " w-14 shrink-0"}
                      value={sub.qos}
                      onChange={(e) =>
                        updateSub(
                          index(),
                          "qos",
                          parseInt(e.currentTarget.value)
                        )
                      }
                    >
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                    <button
                      class="p-1 text-slate-500 hover:text-red-400"
                      onClick={() => removeSub(index())}
                    >
                      <svg
                        class="w-3.5 h-3.5"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                      >
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    </button>
                  </div>
                )}
              </For>
              <Show when={subscriptions().length === 0}>
                <div class="text-xs text-slate-500 py-1">
                  No subscriptions. Add at least one to receive messages.
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-700">
          <button
            class="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            onClick={handleSave}
          >
            {isEditing() ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
