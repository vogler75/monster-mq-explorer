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
const [archiveGroupsMap, setArchiveGroupsMap] = createSignal<Map<string, string[]>>(new Map());
// WinCC UA: logging tags per topic per connection — Map<connectionId, Map<tagName, loggingTagNames[]>>
const [loggingTagsMap, setLoggingTagsMap] = createSignal<Map<string, Map<string, string[]>>>(new Map());
// WinCC UA: cached auth tokens per connection
const [winccTokens, setWinccTokens] = createSignal<Map<string, string>>(new Map());
// WinCC UA: topic path → original tag name mapping per connection
const [topicTagNameMap, setTopicTagNameMap] = createSignal<Map<string, Map<string, string>>>(new Map());

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

    getArchiveGroups(connectionId: string): string[] {
      return archiveGroupsMap().get(connectionId) ?? [];
    },
    setArchiveGroups(connectionId: string, groups: string[]) {
      setArchiveGroupsMap((prev) => new Map(prev).set(connectionId, groups));
    },

    getLoggingTags(connectionId: string, tagName: string): string[] {
      return loggingTagsMap().get(connectionId)?.get(tagName) ?? [];
    },
    setLoggingTags(connectionId: string, tagName: string, loggingTags: string[]) {
      setLoggingTagsMap((prev) => {
        const next = new Map(prev);
        const inner = new Map(next.get(connectionId) ?? []);
        inner.set(tagName, loggingTags);
        next.set(connectionId, inner);
        return next;
      });
    },

    getOriginalTagName(connectionId: string, topic: string): string | undefined {
      return topicTagNameMap().get(connectionId)?.get(topic);
    },
    getTopicTagNameMap(connectionId: string): Map<string, string> {
      return topicTagNameMap().get(connectionId) ?? new Map();
    },
    setTopicTagNameMap(connectionId: string, mapping: Map<string, string>) {
      setTopicTagNameMap((prev) => new Map(prev).set(connectionId, mapping));
    },

    getWinccToken(connectionId: string): string | undefined {
      return winccTokens().get(connectionId);
    },
    setWinccToken(connectionId: string, token: string) {
      setWinccTokens((prev) => new Map(prev).set(connectionId, token));
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
