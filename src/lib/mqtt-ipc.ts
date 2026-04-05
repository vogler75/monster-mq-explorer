/**
 * IPC adapter that wraps window.mqttIpc (Electron main-process TCP MQTT)
 * into a Worker-like interface so App.tsx can use it interchangeably.
 */
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "../workers/mqtt.protocol";

declare global {
  interface Window {
    mqttIpc?: {
      send: (connectionId: string, command: WorkerCommand) => void;
      onEvent: (callback: (connectionId: string, event: WorkerEvent) => void) => () => void;
      setIgnoreCertHosts: (hosts: string[]) => Promise<void>;
      graphqlProxy: (args: { url: string; body: object; token?: string; ignoreCertErrors?: boolean }) => Promise<unknown>;
    };
  }
}

export interface WorkerLike {
  postMessage(cmd: WorkerCommand): void;
  onmessage: ((e: MessageEvent<WorkerEvent>) => void) | null;
  terminate(): void;
}

/**
 * Creates a Worker-like object that routes commands through Electron IPC
 * to the main process TCP MQTT handler.
 */
export function createIpcAdapter(connectionId: string): WorkerLike {
  const ipc = window.mqttIpc!;
  let cleanup: (() => void) | null = null;

  const adapter: WorkerLike = {
    onmessage: null,

    postMessage(cmd: WorkerCommand) {
      // Set up listener on first command (connect) if not already
      if (!cleanup) {
        cleanup = ipc.onEvent((id, event) => {
          if (id !== connectionId) return;
          // Convert payload arrays back to Uint8Array (IPC serializes them)
          if (event.type === "messages") {
            for (const m of event.batch) {
              if (Array.isArray(m.payload)) {
                (m as SerializedMessage).payload = new Uint8Array(m.payload as unknown as number[]);
              }
            }
          }
          if (adapter.onmessage) {
            adapter.onmessage({ data: event } as MessageEvent<WorkerEvent>);
          }
        });
      }
      ipc.send(connectionId, cmd);
    },

    terminate() {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
  };

  return adapter;
}

/** True when running in Electron with the TCP IPC bridge available */
export function hasMqttIpc(): boolean {
  return typeof window !== "undefined" && !!window.mqttIpc;
}
