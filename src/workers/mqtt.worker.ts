import mqtt from "mqtt";
import type { WorkerCommand, WorkerEvent, SerializedMessage } from "./mqtt.protocol";

let client: mqtt.MqttClient | null = null;
let pendingMessages: SerializedMessage[] = [];
let flushScheduled = false;

function post(event: WorkerEvent, transferables?: Transferable[]) {
  if (transferables) {
    self.postMessage(event, transferables);
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

  const { host, port, protocol, path, username, password, clientId } =
    config.config;
  const url = `${protocol}://${host}:${port}${path}`;

  client = mqtt.connect(url, {
    clientId,
    username: username || undefined,
    password: password || undefined,
    protocolVersion: 4, // MQTT 3.1.1
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    post({ type: "connected" });
    // Subscribe to all configured subscriptions
    for (const sub of config.config.subscriptions) {
      client!.subscribe(sub.topic, { qos: sub.qos }, (err) => {
        if (err) {
          post({ type: "error", message: `Subscribe failed: ${sub.topic}: ${err.message}` });
        } else {
          post({ type: "subscribed", topic: sub.topic });
        }
      });
    }
  });

  client.on("message", (topic, payload, packet) => {
    pendingMessages.push({
      topic,
      payload: new Uint8Array(payload),
      qos: packet.qos as 0 | 1 | 2,
      retain: packet.retain,
      timestamp: Date.now(),
    });
    scheduleFlush();
  });

  client.on("error", (err) => {
    post({ type: "error", message: err.message });
  });

  client.on("close", () => {
    post({ type: "disconnected" });
  });

  client.on("offline", () => {
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
      break;

    case "subscribe":
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
