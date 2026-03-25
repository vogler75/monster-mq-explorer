import { createSignal, For, Show } from "solid-js";
import { useConnections } from "../../stores/connections";
import { useUI } from "../../stores/ui";
import type { Subscription } from "../../types/mqtt";
import TagBrowserModal from "./TagBrowserModal";
import { loginAndBrowse as winccoaBrowse } from "../../lib/winccoa-api";

export default function SubscriptionModal() {
  const { connections, activeConnectionId, addSubscription, removeSubscriptionAt, updateSubscription } =
    useConnections();
  const { getConnectionStatus, subscribeLive, unsubscribeLive, setShowSubscriptionModal } = useUI();
  const connectionStatus = () => activeConnectionId() ? getConnectionStatus(activeConnectionId()!) : "disconnected";

  const activeConn = () => connections.find((c) => c.id === activeConnectionId());
  const subs = () => activeConn()?.subscriptions ?? [];
  const isWinCC = () => activeConn()?.connectionType !== "mqtt";

  const [newTopic, setNewTopic] = createSignal("");
  const [newQos, setNewQos] = createSignal<0 | 1 | 2>(0);
  const [showTagBrowser, setShowTagBrowser] = createSignal(false);

  function handleAdd() {
    const topic = newTopic().trim();
    if (!topic || !activeConnectionId()) return;
    const sub: Subscription = { topic, qos: newQos() };
    addSubscription(activeConnectionId()!, sub);
    if (!isWinCC() && connectionStatus() === "connected") subscribeLive(topic, newQos());
    setNewTopic("");
    setNewQos(0);
  }

  function handleRemove(index: number, topic: string) {
    if (!activeConnectionId()) return;
    removeSubscriptionAt(activeConnectionId()!, index);
    if (!isWinCC() && connectionStatus() === "connected") unsubscribeLive(topic);
  }

  function handleQosChange(topic: string, qos: 0 | 1 | 2) {
    if (!activeConnectionId() || isWinCC()) return;
    updateSubscription(activeConnectionId()!, topic, { qos });
    if (connectionStatus() === "connected") subscribeLive(topic, qos);
  }

  const inputBase =
    "px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500";

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) setShowSubscriptionModal(false); }}
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg w-[480px] max-h-[80vh] flex flex-col shadow-xl">
        <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
          <div>
            <h2 class="text-sm font-semibold text-slate-200">
              {isWinCC() ? "Tag Filters" : "Subscriptions"}
            </h2>
            <Show when={activeConn()}>
              <p class="text-xs text-slate-500 mt-0.5">{activeConn()!.name}</p>
            </Show>
          </div>
          <button
            class="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            onClick={() => setShowSubscriptionModal(false)}
          >
            <svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-auto p-4 space-y-2">
          <For each={subs()}>
            {(sub, index) => (
              <div class="flex items-center gap-2">
                <div
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  classList={{
                    "bg-green-500": connectionStatus() === "connected",
                    "bg-slate-600": connectionStatus() !== "connected",
                  }}
                />
                <Show when={sub.tags && sub.tags.length > 0} fallback={
                  <span class="flex-1 min-w-0 text-sm text-slate-300 truncate font-mono text-xs" title={sub.topic}>
                    {sub.topic}
                  </span>
                }>
                  <span class="flex-1 min-w-0 text-xs text-slate-400 italic">
                    {sub.tags!.length} specific tags
                  </span>
                </Show>
                <Show when={!isWinCC()}>
                  <select
                    class={inputBase + " w-16 shrink-0 py-1 text-xs"}
                    value={sub.qos}
                    onChange={(e) => handleQosChange(sub.topic, parseInt(e.currentTarget.value) as 0 | 1 | 2)}
                  >
                    <option value="0">QoS 0</option>
                    <option value="1">QoS 1</option>
                    <option value="2">QoS 2</option>
                  </select>
                </Show>
                <button
                  class="p-1 text-slate-500 hover:text-red-400 shrink-0 transition-colors"
                  onClick={() => handleRemove(index(), sub.topic)}
                  title="Remove"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </div>
            )}
          </For>
          <Show when={subs().length === 0}>
            <p class="text-xs text-slate-500 py-2">
              {isWinCC() ? "No tag filters. Add a filter or browse tags." : "No subscriptions. Add one below."}
            </p>
          </Show>
        </div>

        {/* Add row */}
        <div class="px-4 py-3 border-t border-slate-700 flex items-center gap-2 shrink-0">
          <input
            class={inputBase + " flex-1 min-w-0"}
            placeholder={isWinCC() ? "System1::* or *" : "topic/path/#"}
            value={newTopic()}
            onInput={(e) => setNewTopic(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Show when={!isWinCC()}>
            <select
              class={inputBase + " w-20 shrink-0 py-1.5"}
              value={newQos()}
              onChange={(e) => setNewQos(parseInt(e.currentTarget.value) as 0 | 1 | 2)}
            >
              <option value="0">QoS 0</option>
              <option value="1">QoS 1</option>
              <option value="2">QoS 2</option>
            </select>
          </Show>
          <Show when={isWinCC()}>
            <button
              class="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-600 rounded transition-colors shrink-0"
              onClick={() => setShowTagBrowser(true)}
            >
              Browse…
            </button>
          </Show>
          <button
            class="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors shrink-0"
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      </div>

      <Show when={showTagBrowser() && activeConn()}>
        <TagBrowserModal
          config={{
            host: activeConn()!.host,
            port: activeConn()!.port,
            protocol: activeConn()!.protocol,
            path: activeConn()!.path,
            username: activeConn()!.username,
            password: activeConn()!.password,
          }}
          browseFn={activeConn()?.connectionType === "winccoa" ? winccoaBrowse : undefined}
          onAdd={(tags) => {
            addSubscription(activeConnectionId()!, { topic: "", qos: 0, tags });
            setShowTagBrowser(false);
          }}
          onClose={() => setShowTagBrowser(false)}
        />
      </Show>
    </div>
  );
}
