import { createContext, createSignal, useContext } from "solid-js";
import { createMessageLogStore, type MessageLogStore } from "./messageLog";
import { createChartDataStore, type ChartDataStore } from "./chartData";
import type { SerializedMessage } from "../workers/mqtt.protocol";

// ── Per-tab pinned topics store ─────────────────────────────────────

export interface PinnedTopicsStore {
  pinnedTopics: () => Set<string>;
  isPinned: (topic: string) => boolean;
  pinTopics: (topics: string[]) => void;
  unpinTopics: (topics: string[]) => void;
  togglePin: (topic: string) => void;
  clearPinned: () => void;
}

export function createPinnedTopicsStore(): PinnedTopicsStore {
  const [pinnedTopics, setPinnedTopics] = createSignal<Set<string>>(new Set());

  return {
    pinnedTopics,
    isPinned(topic: string) { return pinnedTopics().has(topic); },
    pinTopics(topics: string[]) {
      setPinnedTopics((prev) => {
        const next = new Set(prev);
        for (const t of topics) next.add(t);
        return next;
      });
    },
    unpinTopics(topics: string[]) {
      setPinnedTopics((prev) => {
        const next = new Set(prev);
        for (const t of topics) next.delete(t);
        return next;
      });
    },
    togglePin(topic: string) {
      setPinnedTopics((prev) => {
        const next = new Set(prev);
        if (next.has(topic)) next.delete(topic); else next.add(topic);
        return next;
      });
    },
    clearPinned() { setPinnedTopics(new Set<string>()); },
  };
}

// ── Per-tab context (provided to child components) ──────────────────

export interface TabContextValue {
  messageLog: MessageLogStore;
  chartData: ChartDataStore;
  pinnedTopics: PinnedTopicsStore;
  selectedTopic: () => string | null;
}

export const TabContext = createContext<TabContextValue>();

export function useTabMessageLog(): MessageLogStore {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabMessageLog must be used inside a TabContext.Provider");
  return ctx.messageLog;
}

export function useTabChartData(): ChartDataStore {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabChartData must be used inside a TabContext.Provider");
  return ctx.chartData;
}

export function useTabPinnedTopics(): PinnedTopicsStore {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabPinnedTopics must be used inside a TabContext.Provider");
  return ctx.pinnedTopics;
}

export function useTabSelectedTopic(): () => string | null {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabSelectedTopic must be used inside a TabContext.Provider");
  return ctx.selectedTopic;
}

// ── Tab registry (module-level, used by App.tsx for broadcasting) ───

export interface TabEntry {
  id: string;
  selectedTopic: () => string | null;
  pinnedTopics: () => Set<string>;
  messageLog: MessageLogStore;
  chartData: ChartDataStore;
}

const tabRegistry = new Map<string, TabEntry>();

export function registerTab(entry: TabEntry) {
  tabRegistry.set(entry.id, entry);
}

export function unregisterTab(id: string) {
  tabRegistry.delete(id);
}

/** Broadcast incoming messages to all registered tabs */
export function broadcastMessages(msgs: SerializedMessage[]) {
  for (const tab of tabRegistry.values()) {
    tab.messageLog.addMessages(msgs, tab.selectedTopic(), tab.pinnedTopics());
  }
}

/** Broadcast chart data to all registered tabs */
export function broadcastChartMessage(topic: string, payload: Uint8Array, timestamp: number) {
  for (const tab of tabRegistry.values()) {
    tab.chartData.pushMessage(topic, payload, timestamp);
  }
}

/** Create fresh per-tab stores (selectedTopic must be provided separately) */
export function createTabStores(selectedTopic: () => string | null): TabContextValue {
  return {
    messageLog: createMessageLogStore(),
    chartData: createChartDataStore(),
    pinnedTopics: createPinnedTopicsStore(),
    selectedTopic,
  };
}
