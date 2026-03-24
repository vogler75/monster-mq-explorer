export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: "ws" | "wss";
  path: string;
  username: string;
  password: string;
  clientId: string;
  subscriptions: Subscription[];
}

export interface Subscription {
  topic: string;
  qos: 0 | 1 | 2;
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

export function createDefaultConnection(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "New Connection",
    host: "broker.hivemq.com",
    port: 8884,
    protocol: "wss",
    path: "/mqtt",
    username: "",
    password: "",
    clientId: `monster-mqtt-${Math.random().toString(36).slice(2, 8)}`,
    subscriptions: [{ topic: "#", qos: 0 }],
  };
}
