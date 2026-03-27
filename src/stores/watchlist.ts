import { createSignal, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { Watchlist } from "../types/mqtt";
import { loadWatchlists, saveWatchlists, loadPinnedTopics, savePinnedTopics } from "../lib/persistence";

/** Named saved watchlists (global, shared across tabs). */
const [watchlists, setWatchlists] = createStore<Watchlist[]>([]);

// Bootstrap persisted data on startup.
loadWatchlists().then((savedLists) => {
  setWatchlists(savedLists);
});

export function useWatchlist() {
  return {
    watchlists,

    /** Save a set of topics as a named watchlist */
    saveWatchlist(name: string, topics: Set<string>) {
      const sorted = [...topics].sort();
      const existing = watchlists.findIndex((w) => w.name === name);
      if (existing >= 0) {
        setWatchlists(existing, { topics: sorted });
      } else {
        setWatchlists(produce((list) => {
          list.push({ id: crypto.randomUUID(), name, topics: sorted });
        }));
      }
      saveWatchlists(watchlists.map((w) => ({ id: w.id, name: w.name, topics: [...w.topics] })));
    },

    /** Get the topics of a saved watchlist (caller merges into their pinned set) */
    getWatchlistTopics(id: string): string[] {
      const w = watchlists.find((w) => w.id === id);
      return w ? [...w.topics] : [];
    },

    deleteWatchlist(id: string) {
      setWatchlists((list) => list.filter((w) => w.id !== id));
      saveWatchlists(watchlists.map((w) => ({ id: w.id, name: w.name, topics: [...w.topics] })));
    },
  };
}
