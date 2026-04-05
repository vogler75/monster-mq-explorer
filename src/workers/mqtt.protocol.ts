import type { ConnectionConfig } from "../types/mqtt";

// Main thread -> Worker
export type WorkerCommand =
  | { type: "connect"; config: ConnectionConfig; token?: string; tags?: string[] }
  | { type: "disconnect" }
  | { type: "subscribe"; topic: string; qos: 0 | 1 | 2 }
  | { type: "unsubscribe"; topic: string }
  | {
      type: "publish";
      topic: string;
      payload: string;
      qos: 0 | 1 | 2;
      retain: boolean;
    };

// Worker -> Main thread
export type WorkerEvent =
  | { type: "connected" }
  | { type: "disconnected"; reason?: string }
  | { type: "error"; message: string }
  | { type: "messages"; batch: SerializedMessage[] }
  | { type: "subscribed"; topic: string };

export interface SerializedMessage {
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}
