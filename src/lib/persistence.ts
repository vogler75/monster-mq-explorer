import type { ConnectionConfig } from "../types/mqtt";

export async function loadConnections(): Promise<ConnectionConfig[]> {
  try {
    const res = await fetch("/api/connections");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function saveConnections(connections: ConnectionConfig[]): Promise<void> {
  try {
    await fetch("/api/connections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connections),
    });
  } catch (e) {
    console.error("Failed to save connections:", e);
  }
}
