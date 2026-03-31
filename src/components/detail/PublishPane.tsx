import { createSignal, createEffect, on, Show } from "solid-js";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import { payloadToString } from "../../lib/format";
import { tooltip } from "../ui/tooltip";

export default function PublishPane() {
  const { selectedTopic, publish, getConnectionStatus } = useUI();
  const { activeConnectionId, getConnection } = useConnections();
  const { topicTree } = useTopicTree();

  const connectionStatus = () =>
    activeConnectionId() ? getConnectionStatus(activeConnectionId()!) : "disconnected";

  const isWinCC = () => {
    const connId = activeConnectionId();
    if (!connId) return false;
    const t = getConnection(connId)?.connectionType;
    return t === "winccua" || t === "winccoa";
  };

  function getCleanTopic(fullTopic: string): string {
    const connId = activeConnectionId();
    if (!connId) return fullTopic;
    const conn = getConnection(connId);
    if (!conn) return fullTopic;
    const prefix = `${conn.name}/`;
    return fullTopic.startsWith(prefix) ? fullTopic.slice(prefix.length) : fullTopic;
  }

  const [pubTopic, setPubTopic] = createSignal("");
  const [pubPayload, setPubPayload] = createSignal("");
  const [pubQos, setPubQos] = createSignal<0 | 1 | 2>(0);
  const [pubRetain, setPubRetain] = createSignal(false);
  const [pubFeedback, setPubFeedback] = createSignal<"" | "ok">("");
  const [autoFill, setAutoFill] = createSignal(true);

  function applyTopicFill(topic: string) {
    setPubTopic(getCleanTopic(topic));
    const node = getNodeByTopic(topicTree, topic);
    if (node?.lastMessage) {
      setPubPayload(payloadToString(node.lastMessage.payload));
    }
  }

  // Pre-fill topic and payload when selected topic changes (only when auto-fill is enabled)
  createEffect(on(selectedTopic, (topic) => {
    if (topic && autoFill()) {
      applyTopicFill(topic);
    }
  }));

  function handleTopicInput(e: InputEvent & { currentTarget: HTMLInputElement }) {
    setPubTopic(e.currentTarget.value);
    // Once the user manually edits the topic, disable auto-fill
    setAutoFill(false);
  }

  function toggleAutoFill() {
    const next = !autoFill();
    setAutoFill(next);
    // If re-enabling, immediately populate from currently selected topic
    if (next) {
      const topic = selectedTopic();
      if (topic) applyTopicFill(topic);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doPublish();
    }
  }

  function doPublish() {
    if (connectionStatus() !== "connected" || !pubTopic()) return;
    publish(pubTopic(), pubPayload(), pubQos(), pubRetain());
    setPubFeedback("ok");
    setTimeout(() => setPubFeedback(""), 1500);
  }

  return (
    <div class="h-full flex flex-col bg-slate-900 border-l border-slate-700 overflow-y-auto">
      <div class="px-3 py-2 border-b border-slate-700 shrink-0">
        <span class="text-xs font-medium text-slate-400 uppercase tracking-wider">Publish</span>
      </div>
      <div class="flex flex-col gap-3 p-3">
        <Show when={isWinCC()}>
          <div class="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
            Writing is not yet supported for WinCC connections.
          </div>
        </Show>
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <label class="text-xs text-slate-400">Topic</label>
            <button
              class="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 transition-colors"
              classList={{
                "text-blue-400 bg-blue-400/10 hover:bg-blue-400/20": autoFill(),
                "text-slate-500 bg-slate-700/50 hover:bg-slate-700": !autoFill(),
              }}
              onClick={toggleAutoFill}
              use:tooltip={autoFill() ? "Auto-fill from tree is ON — click to disable" : "Auto-fill from tree is OFF — click to enable"}
            >
              <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <Show when={autoFill()} fallback={
                  // Unlinked icon
                  <path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9q-.261 0-.5.06a2 2 0 0 1-1.95 1.44H4a2 2 0 1 1 0-4h1.535c.218-.376.495-.714.82-1zm4.292 1H12a3 3 0 0 1 0 6H9a3 3 0 0 1-2.83-4H7q.26 0 .5.06a2 2 0 0 0 1.95 1.44H12a2 2 0 1 0 0-4h-1.535a4 4 0 0 0-.82-1z"/>
                }>
                  {/* Linked icon */}
                  <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287zm5.57-1.084a3 3 0 0 0-4.243 4.243L7.87 11.03a3 3 0 0 0 4.243-4.243l-.793.792a2 2 0 0 1-2.83 2.83l-1.828-1.828a2 2 0 0 1 2.83-2.83l.793-.792z"/>
                </Show>
              </svg>
              {autoFill() ? "Auto-fill on" : "Auto-fill off"}
            </button>
          </div>
          <input
            class="bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500 w-full"
            value={pubTopic()}
            onInput={handleTopicInput}
            onKeyDown={handleKeyDown}
            placeholder="topic/path"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400">Payload</label>
          <textarea
            class="bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500 resize-y min-h-[8rem] w-full"
            value={pubPayload()}
            onInput={(e) => setPubPayload(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            rows={8}
          />
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <span class="text-xs text-slate-400">QoS</span>
          {([0, 1, 2] as const).map((q) => (
            <label class="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="pub-qos-pane"
                value={String(q)}
                checked={pubQos() === q}
                onChange={() => setPubQos(q)}
                class="accent-blue-500"
              />
              {q}
            </label>
          ))}
          <label class="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={pubRetain()}
              onChange={(e) => setPubRetain(e.currentTarget.checked)}
              class="accent-blue-500"
            />
            Retain
          </label>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="px-4 py-1.5 text-xs rounded transition-colors"
            classList={{
              "bg-blue-600 hover:bg-blue-500 text-white": connectionStatus() === "connected" && !!pubTopic() && !isWinCC(),
              "bg-slate-700 text-slate-500 cursor-not-allowed": connectionStatus() !== "connected" || !pubTopic() || isWinCC(),
            }}
            disabled={connectionStatus() !== "connected" || !pubTopic() || isWinCC()}
            onClick={doPublish}
          >
            Publish
          </button>
          <Show when={pubFeedback() === "ok"}>
            <span class="text-xs text-green-400">Sent!</span>
          </Show>
          <span class="text-xs text-slate-600 ml-auto">⌘↵ to send</span>
        </div>
      </div>
    </div>
  );
}
