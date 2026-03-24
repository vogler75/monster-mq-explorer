import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
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

const [logEnabled, setLogEnabled] = createSignal(false);
const [logMaxRows, setLogMaxRows] = createSignal(500);
const [logAutoScroll, setLogAutoScroll] = createSignal(true);
const [logOrder, setLogOrder] = createSignal<"newest-top" | "newest-bottom">("newest-bottom");
const [logMessages, setLogMessages] = createStore<LoggedMessage[]>([]);

export function useMessageLog() {
  return {
    logEnabled,
    setLogEnabled,
    logMaxRows,
    setLogMaxRows,
    logAutoScroll,
    setLogAutoScroll,
    logOrder,
    setLogOrder,
    logMessages,

    addMessages(msgs: SerializedMessage[], selectedTopic: string | null) {
      if (!logEnabled() || selectedTopic === null) return;
      const prefix = selectedTopic + "/";
      const matching = msgs.filter(
        (m) => m.topic === selectedTopic || m.topic.startsWith(prefix)
      );
      if (matching.length === 0) return;

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
    },
  };
}
