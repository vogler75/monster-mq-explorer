import { createEffect, createSignal, Show, createMemo } from "solid-js";
import type { FlatTreeNode } from "../../types/mqtt";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { tooltip } from "../ui/tooltip";

interface Props {
  node: FlatTreeNode | undefined;
  isSelected: boolean;
  onSelect: (topic: string) => void;
  onToggle: (topic: string) => void;
}

export default function TopicRow(props: Props) {
  const { flashEnabled, subscribeLive, unsubscribeLive } = useUI();
  const { activeConnectionId, getConnection, addSubscription, removeSubscriptionAt } = useConnections();
  const [flash, setFlash] = createSignal(false);

  // Flash on update
  let lastKey = "";
  let lastUpdated = 0;
  createEffect(() => {
    const node = props.node;
    if (!node) return;
    const ts = node.node.lastUpdated;
    const key = node.key;
    if (key !== lastKey) {
      lastKey = key;
      lastUpdated = ts;
      return;
    }
    if (ts > lastUpdated && lastUpdated > 0) {
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
    }
    lastUpdated = ts;
  });

  const nodeStatus = () => {
    const node = props.node;
    if (!node) return "normal";

    const connId = activeConnectionId();
    if (!connId) return "normal";
    const conn = getConnection(connId);
    if (!conn) return "normal";

    const prefix = `${conn.name}/`;
    if (!node.key.startsWith(prefix) && node.key !== conn.name) {
      return "normal";
    }

    if (!conn.isMonsterMq) return "normal";

    const cleanTopic = node.key.startsWith(prefix) ? node.key.slice(prefix.length) : node.key;
    if (node.key === conn.name) return "normal";

    const isSubscribed = conn.subscriptions.some((sub) => mqttTopicMatch(sub.topic, cleanTopic));
    if (isSubscribed) return "subscribed";

    if (node.node.isBrowsed) return "browsed";

    return "normal";
  };

  const isMonsterMq = () => {
    const connId = activeConnectionId();
    return connId ? getConnection(connId)?.isMonsterMq ?? false : false;
  };

  const connName = () => {
    const connId = activeConnectionId();
    return connId ? getConnection(connId)?.name ?? "" : "";
  };

  const getCleanTopic = () => {
    const node = props.node;
    if (!node) return "";
    const prefix = `${connName()}/`;
    return node.key.startsWith(prefix) ? node.key.slice(prefix.length) : node.key;
  };

  const isSubscribedToWildcard = createMemo(() => {
    const connId = activeConnectionId();
    if (!connId) return false;
    const conn = getConnection(connId);
    if (!conn) return false;
    const cleanTopic = getCleanTopic();
    if (!cleanTopic) return false;
    const wildcardTopic = `${cleanTopic}/#`;
    return conn.subscriptions.some((sub) => sub.topic === wildcardTopic);
  });

  function subscribeToWildcard() {
    const connId = activeConnectionId();
    if (!connId) return;
    const cleanTopic = getCleanTopic();
    if (!cleanTopic) return;
    const wildcardTopic = `${cleanTopic}/#`;
    addSubscription(connId, { topic: wildcardTopic, qos: 0 });
    subscribeLive(wildcardTopic, 0);
  }

  function unsubscribeFromWildcard() {
    const connId = activeConnectionId();
    if (!connId) return;
    const conn = getConnection(connId);
    if (!conn) return;
    const cleanTopic = getCleanTopic();
    if (!cleanTopic) return;
    const wildcardTopic = `${cleanTopic}/#`;
    const idx = conn.subscriptions.findIndex((sub) => sub.topic === wildcardTopic);
    if (idx !== -1) {
      removeSubscriptionAt(connId, idx);
      unsubscribeLive(wildcardTopic);
    }
  }

  return (
    <Show when={props.node}>
      {(flatNode) => (
        <div
          class="group flex items-center h-7 px-1 cursor-pointer select-none text-xs hover:bg-slate-700/50 transition-colors"
          classList={{
            "bg-blue-600/20": props.isSelected,
            "text-blue-200": props.isSelected && nodeStatus() === "normal",
            "text-slate-300": !props.isSelected && nodeStatus() === "normal",
            "text-emerald-400 font-medium": !props.isSelected && nodeStatus() === "subscribed",
            "text-emerald-200 font-medium": props.isSelected && nodeStatus() === "subscribed",
            "text-sky-400 font-medium": !props.isSelected && nodeStatus() === "browsed",
            "text-sky-200 font-medium": props.isSelected && nodeStatus() === "browsed",
            "row-updated": flashEnabled() && flash(),
          }}
          style={{ "padding-left": `${flatNode().depth * 16 + 4}px` }}
          onClick={() => props.onSelect(flatNode().key)}
        >
          {/* Expand/collapse chevron */}
          <span
            class="w-4 h-4 flex items-center justify-center shrink-0 text-slate-500"
            classList={{ invisible: !flatNode().hasChildren }}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(flatNode().key);
            }}
          >
            <svg
              class="w-3 h-3 transition-transform"
              classList={{ "rotate-90": flatNode().isExpanded }}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M4 2l4 4-4 4z" />
            </svg>
          </span>

          {/* Topic segment name */}
          <span class="truncate ml-1">{flatNode().node.segment}</span>

          {/* MonsterMQ Subscribe/Unsubscribe Action button */}
          <Show when={isMonsterMq() && flatNode().key !== connName()}>
            <div
              class="ml-1 flex items-center shrink-0"
              classList={{
                "opacity-100": isSubscribedToWildcard(),
                "opacity-0 group-hover:opacity-100 transition-opacity": !isSubscribedToWildcard()
              }}
            >
              <Show
                when={isSubscribedToWildcard()}
                fallback={
                  <button
                    class="p-0.5 rounded text-slate-500 hover:text-emerald-400 hover:bg-slate-700 transition-colors shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      subscribeToWildcard();
                    }}
                    use:tooltip={`Subscribe to ${getCleanTopic()}/#`}
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M7 2v10M2 7h10" />
                    </svg>
                  </button>
                }
              >
                <button
                  class="p-0.5 rounded text-emerald-400 hover:text-red-400 hover:bg-slate-700 transition-colors shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    unsubscribeFromWildcard();
                  }}
                  use:tooltip={`Unsubscribe from ${getCleanTopic()}/#`}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M2.5 7.5l3 3 6-6" />
                  </svg>
                </button>
              </Show>
            </div>
          </Show>

          {/* Message count badge */}
          <Show when={flatNode().node.messageCount > 0}>
            <span class="ml-auto px-1.5 py-0.5 text-[10px] bg-slate-700 text-slate-400 rounded-full shrink-0">
              {flatNode().node.messageCount}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}

function mqttTopicMatch(pattern: string, topic: string): boolean {
  if (pattern === "#" || pattern === "*") return true;
  const patternSegs = pattern.split("/");
  const topicSegs = topic.split("/");
  for (let i = 0; i < patternSegs.length; i++) {
    const p = patternSegs[i];
    if (p === "#") return true;
    if (p === "+") {
      if (i >= topicSegs.length) return false;
      continue;
    }
    if (p !== topicSegs[i]) return false;
  }
  return patternSegs.length === topicSegs.length;
}
