import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { Watchlist } from "../types/mqtt";
import { loadWatchlists, saveWatchlists } from "../lib/persistence";

/** Topics that are currently pinned (sticky) in the live table. */
const [pinnedTopics, setPinnedTopics] = createSignal<Set<string>>(new Set());

/** Named saved watchlists. */
const [watchlists, setWatchlists] = createStore<Watchlist[]>([]);

// Bootstrap persisted watchlists on startup.
loadWatchlists().then((saved: Watchlist[]) => setWatchlists(saved));

export function useWatchlist() {
  return {
    pinnedTopics,

    isPinned(topic: string) {
      return pinnedTopics().has(topic);
    },

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

    clearPinned() {
      setPinnedTopics(new Set<string>());
    },

    watchlists,

    saveWatchlist(name: string) {
      const topics = [...pinnedTopics()].sort();
      const existing = watchlists.findIndex((w) => w.name === name);
      if (existing >= 0) {
        setWatchlists(existing, { topics });
      } else {
        setWatchlists(produce((list) => {
          list.push({ id: crypto.randomUUID(), name, topics });
        }));
      }
      saveWatchlists([...watchlists]);
    },

    loadWatchlist(id: string) {
      const w = watchlists.find((w) => w.id === id);
      if (!w) return;
      // Merge saved topics into the current pinned set
      setPinnedTopics((prev) => {
        const next = new Set(prev);
        for (const t of w.topics) next.add(t);
        return next;
      });
    },

    deleteWatchlist(id: string) {
      setWatchlists((list) => list.filter((w) => w.id !== id));
      saveWatchlists([...watchlists]);
    },
  };
}
