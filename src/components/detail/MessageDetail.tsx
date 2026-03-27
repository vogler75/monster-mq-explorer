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
import { useConnections } from "../../stores/connections";
import { useTabChartData, useTabPinnedTopics, useTabMessageLog } from "../../stores/tabStore";
import JsonViewer from "./JsonViewer";
import ChartPane from "./ChartPane";

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
  node?: TopicNode;
  overrideMessage?: LoggedMessage | null;
  detailMode?: "detail" | "chart";
  onDetailModeChange?: (mode: "detail" | "chart") => void;
}

export default function MessageDetail(props: Props) {
  const { publish, getConnectionStatus } = useUI();
  const { activeConnectionId, getConnection } = useConnections();
  const connectionStatus = () => activeConnectionId() ? getConnectionStatus(activeConnectionId()!) : "disconnected";
  const chartData = useTabChartData();
  const { pinnedTopics, pinTopics } = useTabPinnedTopics();
  const { liveTopics } = useTabMessageLog();
  const [activeTab, setActiveTab] = createSignal<Tab>("formatted");
  const [copyFeedback, setCopyFeedback] = createSignal(false);
  const mode = () => props.detailMode ?? "detail";

  function getDisplayTopic(): string {
    // Use the message's topic if available (table selection), otherwise use node's topic (tree selection)
    return activeMessage()?.topic ?? props.node?.fullTopic ?? "";
  }

  function getCleanTopic(): string {
    const fullTopic = getDisplayTopic();
    const connId = activeConnectionId();
    if (!connId) return fullTopic;
    const conn = getConnection(connId);
    if (!conn) return fullTopic;
    // Strip connection name prefix if present (used for MQTT connections)
    const prefix = `${conn.name}/`;
    return fullTopic.startsWith(prefix) ? fullTopic.slice(prefix.length) : fullTopic;
  }

  function copyTopicToClipboard() {
    navigator.clipboard.writeText(getCleanTopic()).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
  }

  function clearRetained() {
    if (props.node) publish(props.node.fullTopic, "", 1, true);
  }

  const activeMessage = createMemo(() => props.overrideMessage ?? props.node?.lastMessage ?? null);

  const retainedTopicsBelow = createMemo(() => props.node ? collectRetainedTopics(props.node) : []);

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

  /** Add a JSON path from the current topic to the chart */
  function handleChartPath(path: string) {
    const topic = getDisplayTopic();
    if (!topic) return;

    // Pin the topic if not already
    if (!pinnedTopics().has(topic)) {
      pinTopics([topic]);
    }

    // Activate chart if not already
    if (!chartData.chartActive()) {
      chartData.initSeries(pinnedTopics(), (t) => liveTopics[t]?.payload);
      chartData.setChartActive(true);
    }

    // Ensure series exists for this topic
    const msg = activeMessage();
    chartData.ensureSeries(topic, msg?.payload);

    // Add the path to the topic's chart config
    const config = chartData.getTopicConfig(topic);
    const existingPaths = config.paths || [];
    if (!existingPaths.includes(path)) {
      chartData.updateTopicConfig(topic, "path", [...existingPaths, path]);
    }
  }

  const hexStr = createMemo(() => {
    const msg = activeMessage();
    if (!msg) return "";
    return payloadToHex(msg.payload);
  });

  const [picUrl, setPicUrl] = createSignal<string | null>(null);
  const [picLive, setPicLive] = createSignal(false);
  let prevPicUrl = "";

  function buildPicUrl(payload: Uint8Array) {
    if (prevPicUrl) URL.revokeObjectURL(prevPicUrl);
    const url = URL.createObjectURL(new Blob([payload], { type: detectMimeType(payload) }));
    prevPicUrl = url;
    setPicUrl(url);
  }

  // Auto-update when live mode is on and we're on the Pic tab
  createEffect(() => {
    const msg = activeMessage();
    if (!msg || activeTab() !== "pic" || !picLive()) return;
    buildPicUrl(msg.payload);
  });

  onCleanup(() => { if (prevPicUrl) URL.revokeObjectURL(prevPicUrl); });

  const tabs: { id: Tab; label: string }[] = [
    { id: "formatted", label: "Formatted" },
    { id: "raw", label: "Raw" },
    { id: "hex", label: "Hex" },
    { id: "pic", label: "Pic" },
  ];

  return (
    <div class="h-full flex flex-col">
      {/* Tabs: Detail / Graph | Formatted / Raw / Hex / Pic | topic name */}
      <div class="flex items-center border-b border-slate-700 shrink-0">
        <button
          class="px-4 py-1.5 text-xs transition-colors"
          classList={{
            "text-blue-400 border-b-2 border-blue-400": mode() === "detail",
            "text-slate-400 hover:text-slate-200": mode() !== "detail",
          }}
          onClick={() => props.onDetailModeChange?.("detail")}
        >
          Detail
        </button>
        <button
          class="px-4 py-1.5 text-xs transition-colors"
          classList={{
            "text-blue-400 border-b-2 border-blue-400": mode() === "chart",
            "text-slate-400 hover:text-slate-200": mode() !== "chart",
          }}
          onClick={() => {
            if (!chartData.chartActive()) {
              chartData.initSeries(pinnedTopics(), (t) => liveTopics[t]?.payload);
              chartData.setChartActive(true);
            }
            props.onDetailModeChange?.("chart");
          }}
        >
          Graph
        </button>
        <Show when={mode() === "detail"}>
          <div class="w-px self-stretch bg-slate-600 shrink-0 mx-1" />
          {tabs.map((tab) => (
            <button
              class="px-3 py-1.5 text-xs transition-colors shrink-0"
              classList={{
                "text-slate-200 border-b-2 border-slate-400":
                  activeTab() === tab.id,
                "text-slate-500 hover:text-slate-300": activeTab() !== tab.id,
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </Show>

        {/* Topic name + info, pushed to the right */}
        <Show when={getDisplayTopic()}>
          <div class="flex-1" />
          <div class="flex items-center gap-1.5 px-3 shrink-0 min-w-0">
            <span class="text-xs font-mono text-slate-400 truncate max-w-[250px]" title={getDisplayTopic()}>
              {getDisplayTopic()}
            </span>
            <button
              class="shrink-0 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
              title="Copy topic (without connection name)"
              onClick={copyTopicToClipboard}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="5" width="8" height="8" rx="1" />
                <path d="M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2" />
              </svg>
            </button>
            <Show when={copyFeedback()}>
              <span class="text-xs text-green-400 shrink-0">Copied!</span>
            </Show>
            <Show when={activeMessage()}>
              {(msg) => (
                <span class="text-xs text-slate-500 shrink-0">
                  {formatBytes(msg().payload.byteLength)}
                  <Show when={msg().retain}>
                    <span class="text-amber-400 ml-1.5">R</span>
                  </Show>
                </span>
              )}
            </Show>
          </div>
        </Show>
      </div>

      {/* Content */}
      <Show
        when={mode() === "detail"}
        fallback={
          <div class="flex-1 overflow-hidden min-h-0">
            <ChartPane />
          </div>
        }
      >
        <div class="flex-1 overflow-auto pl-1 pr-4 py-4">
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
                <JsonViewer data={parsedJson()!} onChartPath={handleChartPath} />
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
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                  <button
                    class="px-2.5 py-1 text-xs rounded transition-colors"
                    classList={{
                      "bg-blue-600/20 text-blue-400 border border-blue-600/40": picLive(),
                      "bg-slate-700 text-slate-300 hover:bg-slate-600": !picLive(),
                    }}
                    onClick={() => {
                      const next = !picLive();
                      setPicLive(next);
                      if (next) {
                        const msg = activeMessage();
                        if (msg) buildPicUrl(msg.payload);
                      }
                    }}
                  >
                    Live
                  </button>
                  <Show when={!picLive()}>
                    <button
                      class="px-2.5 py-1 text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 rounded transition-colors"
                      onClick={() => { const msg = activeMessage(); if (msg) buildPicUrl(msg.payload); }}
                    >
                      Show
                    </button>
                  </Show>
                </div>
                <Show when={picUrl()} fallback={
                  <div class="text-slate-500 text-sm">Press Show or enable Live to render the payload as an image.</div>
                }>
                  {(url) => (
                    <img
                      src={url()}
                      alt="payload"
                      class="max-w-full rounded border border-slate-700"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).replaceWith(
                          Object.assign(document.createElement("div"), {
                            className: "text-slate-500 text-sm",
                            textContent: "Payload could not be displayed as an image.",
                          })
                        );
                      }}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
