import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import type { SerializedMessage } from "../workers/mqtt.protocol";
import type { TopicNode } from "../types/mqtt";

export interface LoggedMessage {
  id: number;
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

let idCounter = 0;

export type MessageLogStore = ReturnType<typeof createMessageLogStore>;

/** Factory: creates an independent message log store instance */
export function createMessageLogStore() {
  const [logEnabled, setLogEnabled] = createSignal(true);
  const [logMode, setLogMode] = createSignal<"history" | "live">("live");
  const [logMaxRows, setLogMaxRows] = createSignal(500);
  const [logAutoScroll, setLogAutoScroll] = createSignal(true);
  const [logOrder, setLogOrder] = createSignal<"newest-top" | "newest-bottom">("newest-bottom");
  const [logSort, setLogSort] = createSignal<"time" | "topic">("topic");
  const [logMessages, setLogMessages] = createStore<LoggedMessage[]>([]);
  const [liveTopics, setLiveTopics] = createStore<Record<string, LoggedMessage>>({});
  const [recentlyUpdated, setRecentlyUpdated] = createSignal<Set<string>>(new Set());

  return {
    logEnabled, setLogEnabled,
    logMode, setLogMode,
    logMaxRows, setLogMaxRows,
    logAutoScroll, setLogAutoScroll,
    logOrder, setLogOrder,
    logSort, setLogSort,
    logMessages,
    liveTopics,
    recentlyUpdated,

    addMessages(msgs: SerializedMessage[], selectedTopic: string | null, pinnedTopics?: Set<string>) {
      if (!logEnabled()) return;
      const prefix = selectedTopic ? selectedTopic + "/" : null;
      const matching = msgs.filter((m) => {
        if (pinnedTopics?.has(m.topic)) return true;
        if (!selectedTopic) return false;
        return m.topic === selectedTopic || (prefix !== null && m.topic.startsWith(prefix));
      });
      if (matching.length === 0) return;

      setLiveTopics(
        produce((live) => {
          for (const m of matching) {
            live[m.topic] = { id: live[m.topic]?.id ?? ++idCounter, topic: m.topic, payload: m.payload, qos: m.qos, retain: m.retain, timestamp: m.timestamp };
          }
        })
      );

      const updatedSet = new Set(matching.map((m) => m.topic));
      setRecentlyUpdated((prev) => new Set([...prev, ...updatedSet]));
      setTimeout(() => {
        setRecentlyUpdated((prev) => {
          const next = new Set(prev);
          for (const t of updatedSet) next.delete(t);
          return next;
        });
      }, 650);

      const max = logMaxRows();
      setLogMessages(
        produce((log) => {
          for (const m of matching) {
            log.push({ id: ++idCounter, topic: m.topic, payload: m.payload, qos: m.qos, retain: m.retain, timestamp: m.timestamp });
          }
          if (log.length > max) log.splice(0, log.length - max);
        })
      );
    },

    clearLog(pinnedTopics?: Set<string>) {
      setLogMessages([]);
      if (!pinnedTopics || pinnedTopics.size === 0) {
        setLiveTopics(reconcile({}));
      } else {
        setLiveTopics(
          produce((live) => {
            for (const key of Object.keys(live)) {
              if (!pinnedTopics.has(key)) delete live[key];
            }
          })
        );
      }
    },

    seedLiveFromTree(node: TopicNode) {
      setLiveTopics(
        produce((live) => {
          function walk(n: TopicNode) {
            if (n.lastMessage && n.fullTopic) {
              live[n.fullTopic] = {
                id: live[n.fullTopic]?.id ?? ++idCounter,
                topic: n.fullTopic,
                payload: n.lastMessage.payload,
                qos: n.lastMessage.qos,
                retain: n.lastMessage.retain,
                timestamp: n.lastMessage.timestamp,
              };
            }
            for (const child of Object.values(n.children)) walk(child);
          }
          walk(node);
        })
      );
    },
  };
}

// Default singleton instance (used by useMessageLog for backward compat)
const defaultStore = createMessageLogStore();

export function useMessageLog() {
  return defaultStore;
}
