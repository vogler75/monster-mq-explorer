import { createSignal, createEffect, on, Show } from "solid-js";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { useTopicTree } from "../../stores/topics";
import { getNodeByTopic } from "../../lib/topic-tree";
import { payloadToString } from "../../lib/format";

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

  // Pre-fill topic and payload when selected topic changes
  createEffect(on(selectedTopic, (topic) => {
    if (topic) {
      setPubTopic(getCleanTopic(topic));
      const node = getNodeByTopic(topicTree, topic);
      if (node?.lastMessage) {
        setPubPayload(payloadToString(node.lastMessage.payload));
      }
    }
  }));

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
          <label class="text-xs text-slate-400">Topic</label>
          <input
            class="bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500 w-full"
            value={pubTopic()}
            onInput={(e) => setPubTopic(e.currentTarget.value)}
            placeholder="topic/path"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400">Payload</label>
          <textarea
            class="bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500 resize-y min-h-[8rem] w-full"
            value={pubPayload()}
            onInput={(e) => setPubPayload(e.currentTarget.value)}
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
        </div>
      </div>
    </div>
  );
}
