import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import type { SerializedMessage } from "../workers/mqtt.protocol";

export interface LoggedMessage {
  id: number;
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

let idCounter = 0;

const [logEnabled, setLogEnabled] = createSignal(true);
const [logMode, setLogMode] = createSignal<"history" | "live">("live");
const [logMaxRows, setLogMaxRows] = createSignal(500);
const [logAutoScroll, setLogAutoScroll] = createSignal(true);
const [logOrder, setLogOrder] = createSignal<"newest-top" | "newest-bottom">("newest-bottom");
const [logSort, setLogSort] = createSignal<"time" | "topic">("topic");
const [logMessages, setLogMessages] = createStore<LoggedMessage[]>([]);
const [liveTopics, setLiveTopics] = createStore<Record<string, LoggedMessage>>({});
const [recentlyUpdated, setRecentlyUpdated] = createSignal<Set<string>>(new Set());

export function useMessageLog() {
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

    addMessages(msgs: SerializedMessage[], selectedTopic: string | null) {
      if (!logEnabled() || selectedTopic === null) return;
      const prefix = selectedTopic + "/";
      const matching = msgs.filter(
        (m) => m.topic === selectedTopic || m.topic.startsWith(prefix)
      );
      if (matching.length === 0) return;

      // Always update live topics (one row per topic)
      setLiveTopics(
        produce((live) => {
          for (const m of matching) {
            live[m.topic] = { id: live[m.topic]?.id ?? ++idCounter, topic: m.topic, payload: m.payload, qos: m.qos, retain: m.retain, timestamp: m.timestamp };
          }
        })
      );

      // Track recently updated topics for flash animation
      const updatedSet = new Set(matching.map((m) => m.topic));
      setRecentlyUpdated((prev) => new Set([...prev, ...updatedSet]));
      setTimeout(() => {
        setRecentlyUpdated((prev) => {
          const next = new Set(prev);
          for (const t of updatedSet) next.delete(t);
          return next;
        });
      }, 650);

      // History: append rows, trim to max
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

    clearLog() {
      setLogMessages([]);
      setLiveTopics(reconcile({}));
    },
  };
}
