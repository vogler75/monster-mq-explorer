import { createSignal } from "solid-js";

type PublishFn = (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void;
type SubscribeFn = (topic: string, qos: 0 | 1 | 2) => void;
type UnsubscribeFn = (topic: string) => void;
let publishFn: PublishFn | null = null;
let subscribeFn: SubscribeFn | null = null;
let unsubscribeFn: UnsubscribeFn | null = null;

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

const [selectedTopic, setSelectedTopic] = createSignal<string | null>(null);
const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(new Set());
const [connectionStatuses, setConnectionStatuses_] = createSignal<Map<string, ConnectionStatus>>(new Map());
const [sortTree, setSortTree] = createSignal(false);
const [autoExpand, setAutoExpand] = createSignal(false);
const [showRetainedOnly, setShowRetainedOnly] = createSignal(false);
const [flashEnabled, setFlashEnabled] = createSignal(true);
const [showConnectionModal, setShowConnectionModal] = createSignal(false);
const [showSubscriptionModal, setShowSubscriptionModal] = createSignal(false);
const [editingConnectionId, setEditingConnectionId] = createSignal<string | null>(null);

export function useUI() {
  return {
    selectedTopic,
    setSelectedTopic,
    expandedNodes,
    sortTree,
    toggleSort() { setSortTree((v) => !v); },
    autoExpand,
    toggleAutoExpand() { setAutoExpand((v) => !v); },
    showRetainedOnly,
    toggleShowRetainedOnly() { setShowRetainedOnly((v) => !v); },
    flashEnabled,
    toggleFlashEnabled() { setFlashEnabled((v) => !v); },

    expandAll(paths: string[]) {
      setExpandedNodes(new Set(paths));
    },

    expandTopics(topics: string[]) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        for (const topic of topics) {
          const segments = topic.split("/");
          for (let i = 1; i < segments.length; i++) {
            next.add(segments.slice(0, i).join("/"));
          }
        }
        return next;
      });
    },

    connectionStatuses,
    getConnectionStatus(id: string): ConnectionStatus {
      return connectionStatuses().get(id) ?? "disconnected";
    },
    setConnectionStatus(id: string, status: ConnectionStatus) {
      setConnectionStatuses_((prev) => new Map(prev).set(id, status));
    },

    showConnectionModal,
    setShowConnectionModal,
    showSubscriptionModal,
    setShowSubscriptionModal,
    editingConnectionId,
    setEditingConnectionId,

    toggleExpanded(topic: string) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(topic)) next.delete(topic); else next.add(topic);
        return next;
      });
    },

    setPublishFn(fn: PublishFn) { publishFn = fn; },
    publish(topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) {
      publishFn?.(topic, payload, qos, retain);
    },
    setSubscribeFn(fn: SubscribeFn) { subscribeFn = fn; },
    setUnsubscribeFn(fn: UnsubscribeFn) { unsubscribeFn = fn; },
    subscribeLive(topic: string, qos: 0 | 1 | 2) { subscribeFn?.(topic, qos); },
    unsubscribeLive(topic: string) { unsubscribeFn?.(topic); },

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
