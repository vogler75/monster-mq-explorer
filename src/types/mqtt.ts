export interface ConnectionConfig {
  id: string;
  name: string;
  connectionType: "mqtt" | "winccua" | "winccoa";
  host: string;
  port: number;
  protocol: "ws" | "wss";
  path: string;
  username: string;
  password: string;
  clientId: string;
  subscriptions: Subscription[];
  /** WinCC UA/OA: string whose individual characters are each treated as a separator
   *  and replaced with '/' when converting a tag name to a topic path.
   *  E.g. "." replaces every '.' with '/'. WinCC OA always also replaces ':'; WinCC UA always also replaces '::'. */
  tagPathSplit: string;
  /** WinCC UA/OA: filter out internal tags (WinCC UA: starting with '@', WinCC OA: starting with '_') */
  filterInternalTags: boolean;
}

export interface Subscription {
  topic: string;
  qos: 0 | 1 | 2;
  /** WinCC UA: explicit list of tag names (overrides topic filter when set) */
  tags?: string[];
}

export interface MqttMessage {
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

export interface TopicNode {
  segment: string;
  fullTopic: string;
  children: Record<string, TopicNode>;
  messageCount: number;
  lastMessage: MqttMessage | null;
  lastUpdated: number;
}

export interface FlatTreeNode {
  node: TopicNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  key: string;
}

/** A named, saved set of pinned topic full-paths. */
export interface Watchlist {
  id: string;
  name: string;
  topics: string[];
}

export function createDefaultConnection(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "New Connection",
    connectionType: "mqtt",
    host: "broker.hivemq.com",
    port: 8884,
    protocol: "wss",
    path: "/mqtt",
    username: "",
    password: "",
    clientId: `monster-mqtt-${Math.random().toString(36).slice(2, 8)}`,
    subscriptions: [{ topic: "#", qos: 0 }],
    tagPathSplit: "",
    filterInternalTags: false,
  };
}

export function createDefaultWinCCOAConnection(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "New WinCC OA Connection",
    connectionType: "winccoa",
    host: "localhost",
    port: 443,
    protocol: "wss",
    path: "/graphql",
    username: "",
    password: "",
    clientId: "",
    subscriptions: [{ topic: "*", qos: 0 }],
    tagPathSplit: "",
    filterInternalTags: false,
  };
}

export function createDefaultWinCCUAConnection(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "New WinCC Unified Connection",
    connectionType: "winccua",
    host: "localhost",
    port: 443,
    protocol: "wss",
    path: "/graphql",
    username: "",
    password: "",
    clientId: "",
    subscriptions: [{ topic: "*", qos: 0 }],
    tagPathSplit: "",
    filterInternalTags: true,
  };
}
