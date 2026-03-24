import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js";
import type { TopicNode } from "../../types/mqtt";
import type { LoggedMessage } from "../../stores/messageLog";
import {
  payloadToString,
  tryParseJson,
  payloadToHex,
  formatBytes,
  formatTimestamp,
} from "../../lib/format";
import { collectRetainedTopics } from "../../lib/topic-tree";
import { useUI } from "../../stores/ui";
import JsonViewer from "./JsonViewer";

type Tab = "formatted" | "raw" | "hex" | "pic";

function detectMimeType(payload: Uint8Array): string {
  const b = payload;
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  return "image/jpeg"; // fallback — let the browser decide
}

interface Props {
  node: TopicNode;
  overrideMessage?: LoggedMessage | null;
}

export default function MessageDetail(props: Props) {
  const { publish, connectionStatus } = useUI();
  const [activeTab, setActiveTab] = createSignal<Tab>("formatted");

  function clearRetained() {
    publish(props.node.fullTopic, "", 1, true);
  }

  const activeMessage = createMemo(() => props.overrideMessage ?? props.node.lastMessage);

  const retainedTopicsBelow = createMemo(() => collectRetainedTopics(props.node));

  function clearAllRetainedBelow() {
    for (const topic of retainedTopicsBelow()) {
      publish(topic, "", 1, true);
    }
  }

  const payloadStr = createMemo(() => {
    const msg = activeMessage();
    if (!msg) return "";
    return payloadToString(msg.payload);
  });

  const parsedJson = createMemo(() => tryParseJson(payloadStr()));

  const hexStr = createMemo(() => {
    const msg = activeMessage();
    if (!msg) return "";
    return payloadToHex(msg.payload);
  });

  const [picUrl, setPicUrl] = createSignal<string | null>(null);

  createEffect(() => {
    const msg = activeMessage();
    const prev = picUrl();
    if (prev) URL.revokeObjectURL(prev);
    if (!msg || activeTab() !== "pic") { setPicUrl(null); return; }
    const blob = new Blob([msg.payload], { type: detectMimeType(msg.payload) });
    setPicUrl(URL.createObjectURL(blob));
  });

  onCleanup(() => { const u = picUrl(); if (u) URL.revokeObjectURL(u); });

  const tabs: { id: Tab; label: string }[] = [
    { id: "formatted", label: "Formatted" },
    { id: "raw", label: "Raw" },
    { id: "hex", label: "Hex" },
    { id: "pic", label: "Pic" },
  ];

  return (
    <div class="h-full flex flex-col">
      {/* Topic header */}
      <div class="px-4 py-3 border-b border-slate-700 bg-slate-800/50">
        <div class="flex items-start justify-between gap-2">
          <div class="text-sm font-mono font-medium text-slate-200 break-all">
            {props.node.fullTopic}
          </div>
          <Show when={connectionStatus() === "connected"}>
            <div class="flex gap-1.5 shrink-0">
              <Show when={activeMessage()?.retain}>
                <button
                  class="px-2 py-0.5 text-xs rounded bg-amber-900/50 text-amber-400 hover:bg-amber-800/60 border border-amber-700/50 transition-colors"
                  title="Publish empty payload with retain=true to clear this retained message"
                  onClick={clearRetained}
                >
                  Clear retained
                </button>
              </Show>
              <Show when={retainedTopicsBelow().length > 0}>
                <button
                  class="px-2 py-0.5 text-xs rounded bg-red-900/50 text-red-400 hover:bg-red-800/60 border border-red-700/50 transition-colors"
                  title={`Clear all ${retainedTopicsBelow().length} retained messages below this node`}
                  onClick={clearAllRetainedBelow}
                >
                  Clear all retained ({retainedTopicsBelow().length})
                </button>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={activeMessage()}>
          {(msg) => (
            <div class="flex gap-4 mt-1.5 text-xs text-slate-400">
              <span>QoS {msg().qos}</span>
              <Show when={msg().retain}>
                <span class="text-amber-400">retained</span>
              </Show>
              <span>{formatBytes(msg().payload.byteLength)}</span>
              <span>{formatTimestamp(msg().timestamp)}</span>
              <Show when={!props.overrideMessage}>
                <span>{props.node.messageCount.toLocaleString()} total messages</span>
              </Show>
            </div>
          )}
        </Show>
      </div>

      {/* Tabs */}
      <div class="flex border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            class="px-4 py-1.5 text-xs transition-colors"
            classList={{
              "text-blue-400 border-b-2 border-blue-400":
                activeTab() === tab.id,
              "text-slate-400 hover:text-slate-200": activeTab() !== tab.id,
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div class="flex-1 overflow-auto p-4">
        <Show when={activeMessage()} fallback={
          <div class="text-slate-500 text-sm">No messages received yet</div>
        }>
          {activeTab() === "formatted" ? (
            <Show
              when={parsedJson() !== null}
              fallback={
                <pre class="text-sm font-mono text-slate-300 whitespace-pre-wrap break-all">
                  {payloadStr()}
                </pre>
              }
            >
              <JsonViewer data={parsedJson()!} />
            </Show>
          ) : activeTab() === "raw" ? (
            <pre class="text-sm font-mono text-slate-300 whitespace-pre-wrap break-all">
              {payloadStr()}
            </pre>
          ) : activeTab() === "hex" ? (
            <pre class="text-sm font-mono text-slate-400 whitespace-pre-wrap break-all">
              {hexStr()}
            </pre>
          ) : (
            <Show when={picUrl()} fallback={
              <div class="text-slate-500 text-sm">Loading image…</div>
            }>
              {(url) => (
                <img
                  src={url()}
                  alt="payload"
                  class="max-w-full rounded border border-slate-700"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).replaceWith(
                    Object.assign(document.createElement("div"), {
                      className: "text-slate-500 text-sm",
                      textContent: "Payload could not be displayed as an image.",
                    })
                  ); }}
                />
              )}
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}
