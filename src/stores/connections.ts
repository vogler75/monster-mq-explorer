import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { ConnectionConfig, Subscription } from "../types/mqtt";
import { createDefaultConnection } from "../types/mqtt";
import { loadConnections, saveConnections } from "../lib/persistence";

const [connections, setConnections] = createStore<ConnectionConfig[]>([]);
const [connectionsLoaded, setConnectionsLoaded] = createSignal(false);

const [activeConnectionId, setActiveConnectionId] = createSignal<
  string | null
>(null);

// Load from server on startup
loadConnections().then((loaded) => {
  setConnections(loaded);
  setConnectionsLoaded(true);
});

// Debounced persist — called explicitly after mutations
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persistConnections() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveConnections([...connections]);
  }, 300);
}

export function useConnections() {
  return {
    connections,
    connectionsLoaded,
    activeConnectionId,
    setActiveConnectionId,

    addConnection(config?: Partial<ConnectionConfig>) {
      const conn = { ...createDefaultConnection(), ...config };
      setConnections(produce((list) => list.push(conn)));
      persistConnections();
      return conn;
    },

    updateConnection(id: string, updates: Partial<ConnectionConfig>) {
      setConnections(
        (c) => c.id === id,
        produce((c) => Object.assign(c, updates))
      );
      persistConnections();
    },

    removeConnection(id: string) {
      setConnections((list) => list.filter((c) => c.id !== id));
      if (activeConnectionId() === id) {
        setActiveConnectionId(null);
      }
      persistConnections();
    },

    getConnection(id: string) {
      return connections.find((c) => c.id === id);
    },

    addSubscription(id: string, sub: Subscription) {
      setConnections(
        (c) => c.id === id,
        produce((c) => {
          if (!c.subscriptions.find((s) => s.topic === sub.topic)) {
            c.subscriptions.push(sub);
          }
        })
      );
      persistConnections();
    },

    removeSubscription(id: string, topic: string) {
      setConnections(
        (c) => c.id === id,
        produce((c) => {
          c.subscriptions = c.subscriptions.filter((s) => s.topic !== topic);
        })
      );
      persistConnections();
    },

    updateSubscription(id: string, topic: string, updates: Partial<Subscription>) {
      setConnections(
        (c) => c.id === id,
        produce((c) => {
          const sub = c.subscriptions.find((s) => s.topic === topic);
          if (sub) Object.assign(sub, updates);
        })
      );
      persistConnections();
    },
  };
}
