import { createSignal, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { Watchlist } from "../types/mqtt";
import { loadWatchlists, saveWatchlists, loadPinnedTopics, savePinnedTopics } from "../lib/persistence";

/** Topics that are currently pinned (sticky) in the live table. */
const [pinnedTopics, setPinnedTopics] = createSignal<Set<string>>(new Set());

/** Named saved watchlists. */
const [watchlists, setWatchlists] = createStore<Watchlist[]>([]);

/**
 * Guard that prevents the auto-save effect from firing before the initial
 * async load has resolved.  Without this, `createEffect` runs immediately
 * with an empty Set and overwrites whatever was previously persisted.
 */
let persistenceReady = false;

// Bootstrap persisted data on startup.
Promise.all([
  loadWatchlists(),
  loadPinnedTopics(),
]).then(([savedLists, savedPinned]) => {
  setWatchlists(savedLists);
  if (savedPinned.length > 0) setPinnedTopics(new Set(savedPinned));
  persistenceReady = true;
});

// Persist pinned topics whenever they change — but only after the initial
// load has completed so we never overwrite data with an empty set.
createEffect(() => {
  const topics = pinnedTopics();
  if (!persistenceReady) return;
  savePinnedTopics([...topics]);
});

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
      // Convert Solid store proxies to plain objects before IDB write —
      // structuredClone (used by idb-keyval) cannot clone Proxy objects.
      saveWatchlists(watchlists.map((w) => ({ id: w.id, name: w.name, topics: [...w.topics] })));
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
      // Convert Solid store proxies to plain objects before IDB write —
      // structuredClone (used by idb-keyval) cannot clone Proxy objects.
      saveWatchlists(watchlists.map((w) => ({ id: w.id, name: w.name, topics: [...w.topics] })));
    },
  };
}
