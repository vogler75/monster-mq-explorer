import { get, set } from "idb-keyval";
import { createDefaultConnection, type ConnectionConfig, type Subscription } from "../types/mqtt";

const CONNECTIONS_STORAGE_KEY = "monster-mqtt-explorer.connections";

function normalizeQos(value: unknown): 0 | 1 | 2 {
  return value === 1 || value === 2 ? value : 0;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeConnection(input: Partial<ConnectionConfig>): ConnectionConfig {
  const defaults = createDefaultConnection();
  const subscriptions: Subscription[] = Array.isArray(input.subscriptions)
    ? input.subscriptions
        .map((sub) => readRecord(sub))
        .filter((sub): sub is Record<string, unknown> => sub !== null)
        .map((sub) => ({
          topic: typeof sub.topic === "string" ? sub.topic : "",
          qos: normalizeQos(sub.qos),
        }))
        .filter((sub) => sub.topic.trim() !== "")
    : defaults.subscriptions;

  return {
    id: typeof input.id === "string" && input.id ? input.id : defaults.id,
    name: typeof input.name === "string" ? input.name : defaults.name,
    connectionType: input.connectionType === "winccua" ? "winccua" : "mqtt",
    host: typeof input.host === "string" ? input.host : defaults.host,
    port: typeof input.port === "number" && Number.isFinite(input.port) ? input.port : defaults.port,
    protocol: input.protocol === "ws" ? "ws" : defaults.protocol,
    path: typeof input.path === "string" ? input.path : defaults.path,
    username: typeof input.username === "string" ? input.username : defaults.username,
    password: typeof input.password === "string" ? input.password : defaults.password,
    clientId: typeof input.clientId === "string" && input.clientId
      ? input.clientId
      : defaults.clientId,
    subscriptions,
  };
}

function normalizeConnections(input: unknown): ConnectionConfig[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Partial<ConnectionConfig> => !!item && typeof item === "object")
    .map(normalizeConnection);
}

export async function loadConnections(): Promise<ConnectionConfig[]> {
  try {
    const stored = await get<unknown>(CONNECTIONS_STORAGE_KEY);
    const normalized = normalizeConnections(stored);
    if (normalized.length > 0) return normalized;

    try {
      const res = await fetch("/api/connections");
      if (!res.ok) return [];
      const migrated = normalizeConnections(await res.json());
      if (migrated.length > 0) {
        await saveConnections(migrated);
      }
      return migrated;
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

export async function saveConnections(connections: ConnectionConfig[]): Promise<void> {
  await set(CONNECTIONS_STORAGE_KEY, connections);
}

export async function importConnections(jsonText: string): Promise<ConnectionConfig[]> {
  const parsed: unknown = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Import file must contain a JSON array of connections");
  }
  const normalized = normalizeConnections(parsed);
  if (parsed.length > 0 && normalized.length === 0) {
    throw new Error("Import file does not contain any valid connections");
  }
  await saveConnections(normalized);
  return normalized;
}

export function exportConnections(connections: ConnectionConfig[]): string {
  return JSON.stringify(connections, null, 2);
}
