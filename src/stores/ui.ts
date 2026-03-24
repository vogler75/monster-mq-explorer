import { createSignal } from "solid-js";

type PublishFn = (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void;
let publishFn: PublishFn | null = null;

const [selectedTopic, setSelectedTopic] = createSignal<string | null>(null);
const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(
  new Set()
);
const [connectionStatus, setConnectionStatus] = createSignal<
  "disconnected" | "connecting" | "connected"
>("disconnected");
const [sortTree, setSortTree] = createSignal(false);
const [showConnectionModal, setShowConnectionModal] = createSignal(false);
const [editingConnectionId, setEditingConnectionId] = createSignal<
  string | null
>(null);

export function useUI() {
  return {
    selectedTopic,
    setSelectedTopic,
    expandedNodes,
    sortTree,
    toggleSort() { setSortTree((v) => !v); },
    connectionStatus,
    setConnectionStatus,
    showConnectionModal,
    setShowConnectionModal,
    editingConnectionId,
    setEditingConnectionId,

    toggleExpanded(topic: string) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(topic)) {
          next.delete(topic);
        } else {
          next.add(topic);
        }
        return next;
      });
    },

    setPublishFn(fn: PublishFn) { publishFn = fn; },
    publish(topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) {
      publishFn?.(topic, payload, qos, retain);
    },

    expandTo(topic: string) {
      const segments = topic.split("/");
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        for (let i = 1; i <= segments.length; i++) {
          next.add(segments.slice(0, i).join("/"));
        }
        return next;
      });
    },
  };
}
