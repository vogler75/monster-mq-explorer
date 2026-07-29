import mqtt from "mqtt";
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";
import type { Subscription } from "../types/mqtt";

let client: mqtt.MqttClient | null = null;
let pendingMessages: SerializedMessage[] = [];
let flushScheduled = false;
let subscriptions: Subscription[] = [];

function post(event: WorkerEvent, transferables?: Transferable[]) {
  if (transferables) {
    self.postMessage(event, { transfer: transferables });
  } else {
    self.postMessage(event);
  }
}

function flushBatch() {
  if (pendingMessages.length === 0) {
    flushScheduled = false;
    return;
  }
  const batch = pendingMessages;
  pendingMessages = [];
  flushScheduled = false;
  const transferables = batch.map((m) => m.payload.buffer as ArrayBuffer);
  post({ type: "messages", batch }, transferables);
}

function scheduleFlush() {
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flushBatch, 16);
  }
}

function handleConnect(config: WorkerCommand & { type: "connect" }) {
  if (client) {
    client.end(true);
    client = null;
  }

  subscriptions = config.config.subscriptions.map((sub) => ({ ...sub }));
  const { host, port, protocol, path, username, password, clientId } =
    config.config;
  const url = `${protocol}://${host}:${port}${path}`;

  const nextClient = mqtt.connect(url, {
    clientId,
    username: username || undefined,
    password: password || undefined,
    protocolVersion: 4, // MQTT 3.1.1
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  client = nextClient;

  nextClient.on("connect", () => {
    if (client !== nextClient) return;
    post({ type: "connected" });
    // Use the live subscription set so edits survive reconnects.
    for (const sub of subscriptions) {
      nextClient.subscribe(sub.topic, { qos: sub.qos }, (err) => {
        if (err) {
          post({ type: "error", message: `Subscribe failed: ${sub.topic}: ${err.message}` });
        } else {
          post({ type: "subscribed", topic: sub.topic });
        }
      });
    }
  });

  nextClient.on("message", (topic, payload, packet) => {
    if (client !== nextClient) return;
    pendingMessages.push({
      topic,
      payload: new Uint8Array(payload),
      qos: packet.qos as 0 | 1 | 2,
      retain: packet.retain,
      timestamp: Date.now(),
    });
    scheduleFlush();
  });

  nextClient.on("error", (err) => {
    if (client !== nextClient) return;
    post({ type: "error", message: err.message });
  });

  nextClient.on("close", () => {
    if (client !== nextClient) return;
    post({ type: "disconnected" });
  });

  nextClient.on("offline", () => {
    if (client !== nextClient) return;
    post({ type: "disconnected", reason: "offline" });
  });
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;

  switch (cmd.type) {
    case "connect":
      handleConnect(cmd);
      break;

    case "disconnect":
      if (client) {
        client.end(true);
        client = null;
      }
      subscriptions = [];
      break;

    case "subscribe":
      subscriptions = [
        ...subscriptions.filter((sub) => sub.topic !== cmd.topic),
        { topic: cmd.topic, qos: cmd.qos },
      ];
      if (client) {
        client.subscribe(cmd.topic, { qos: cmd.qos }, (err) => {
          if (err) {
            post({ type: "error", message: `Subscribe failed: ${err.message}` });
          } else {
            post({ type: "subscribed", topic: cmd.topic });
          }
        });
      }
      break;

    case "unsubscribe":
      subscriptions = subscriptions.filter((sub) => sub.topic !== cmd.topic);
      if (client) {
        client.unsubscribe(cmd.topic);
      }
      break;

    case "publish":
      if (client) {
        client.publish(cmd.topic, cmd.payload, {
          qos: cmd.qos,
          retain: cmd.retain,
        });
      }
      break;
  }
};
