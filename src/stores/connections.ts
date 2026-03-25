import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { ConnectionConfig, Subscription } from "../types/mqtt";
import { createDefaultConnection } from "../types/mqtt";
import { loadConnections, saveConnections, importConnections as importConnectionsFromJson, exportConnections as exportConnectionsToJson } from "../lib/persistence";

const [connections, setConnections] = createStore<ConnectionConfig[]>([]);
const [connectionsLoaded, setConnectionsLoaded] = createSignal(false);
const [connectionImportError, setConnectionImportError] = createSignal<string | null>(null);

const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);

loadConnections()
  .then((loaded) => {
    setConnections(loaded);
  })
  .finally(() => {
    setConnectionsLoaded(true);
  });

let saveQueue = Promise.resolve();

function persistConnections(nextConnections: ConnectionConfig[]) {
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => saveConnections(nextConnections));
}

function resetImportError() {
  setConnectionImportError(null);
}

export function useConnections() {
  return {
    connections,
    connectionsLoaded,
    connectionImportError,
    activeConnectionId,
    setActiveConnectionId,

    addConnection(config?: Partial<ConnectionConfig>) {
      const conn = { ...createDefaultConnection(), ...config };
      const nextConnections = [...connections, conn];
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
      return conn;
    },

    updateConnection(id: string, updates: Partial<ConnectionConfig>) {
      const nextConnections = connections.map((conn) =>
        conn.id === id ? { ...conn, ...updates } : conn
      );
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
    },

    removeConnection(id: string) {
      const nextConnections = connections.filter((c) => c.id !== id);
      setConnections(nextConnections);
      if (activeConnectionId() === id) {
        setActiveConnectionId(null);
      }
      void persistConnections(nextConnections);
      resetImportError();
    },

    getConnection(id: string) {
      return connections.find((c) => c.id === id);
    },

    addSubscription(id: string, sub: Subscription) {
      const nextConnections = connections.map((conn) => {
        if (conn.id !== id) return conn;
        // Deduplicate only for topic-filter subs (not tag-list subs)
        if (!sub.tags && conn.subscriptions.find((s) => !s.tags && s.topic === sub.topic)) return conn;
        return { ...conn, subscriptions: [...conn.subscriptions, sub] };
      });
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
    },

    removeTagFromSubscription(id: string, subIndex: number, tag: string) {
      const nextConnections = connections.map((conn) => {
        if (conn.id !== id) return conn;
        const subs = conn.subscriptions.map((sub, i) => {
          if (i !== subIndex || !sub.tags) return sub;
          return { ...sub, tags: sub.tags.filter((t) => t !== tag) };
        }).filter((sub, i) => i !== subIndex || !sub.tags || sub.tags.length > 0);
        return { ...conn, subscriptions: subs };
      });
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
    },

    removeSubscriptionAt(id: string, index: number) {
      const nextConnections = connections.map((conn) =>
        conn.id === id
          ? { ...conn, subscriptions: conn.subscriptions.filter((_, i) => i !== index) }
          : conn
      );
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
    },

    updateSubscription(id: string, topic: string, updates: Partial<Subscription>) {
      const nextConnections = connections.map((conn) => {
        if (conn.id !== id) return conn;
        return {
          ...conn,
          subscriptions: conn.subscriptions.map((sub) =>
            sub.topic === topic ? { ...sub, ...updates } : sub
          ),
        };
      });
      setConnections(nextConnections);
      void persistConnections(nextConnections);
      resetImportError();
    },

    async importConnections(jsonText: string) {
      try {
        const imported = await importConnectionsFromJson(jsonText);
        setConnections(imported);
        if (imported.length === 0 || !imported.some((conn) => conn.id === activeConnectionId())) {
          setActiveConnectionId(imported[0]?.id ?? null);
        }
        setConnectionImportError(null);
        return true;
      } catch (error) {
        setConnectionImportError(error instanceof Error ? error.message : "Failed to import connections");
        return false;
      }
    },

    exportConnections() {
      resetImportError();
      return exportConnectionsToJson([...connections]);
    },

    clearConnectionImportError() {
      setConnectionImportError(null);
    },
  };
}
