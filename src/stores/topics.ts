import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { TopicNode, MqttMessage } from "../types/mqtt";
import type { SerializedMessage } from "../workers/mqtt.protocol";
import { createRootNode } from "../lib/topic-tree";

const [topicTree, setTopicTree] = createStore<TopicNode>(createRootNode());
const [totalMessages, setTotalMessages] = createSignal(0);
const [messagesPerSecond, setMessagesPerSecond] = createSignal<Map<string, number>>(new Map());

// Track message rate
const msgCountWindows = new Map<string, number>();
const lastRateUpdates = new Map<string, number>();

function updateRate(connectionName: string) {
  const now = Date.now();
  const lastRateUpdate = lastRateUpdates.get(connectionName) ?? now;
  const elapsed = (now - lastRateUpdate) / 1000;
  if (elapsed >= 1) {
    const msgCountWindow = msgCountWindows.get(connectionName) ?? 0;
    setMessagesPerSecond((prev) => new Map(prev).set(connectionName, Math.round(msgCountWindow / elapsed)));
    msgCountWindows.set(connectionName, 0);
    lastRateUpdates.set(connectionName, now);
  } else if (!lastRateUpdates.has(connectionName)) {
    lastRateUpdates.set(connectionName, now);
  }
}

export function useTopicTree() {
  return {
    topicTree,
    totalMessages,
    messagesPerSecond(connectionName: string | null | undefined) {
      return connectionName ? messagesPerSecond().get(connectionName) ?? 0 : 0;
    },

    processBatch(messages: SerializedMessage[], connectionName: string): string[] {
      const newTopics: string[] = [];
      setTopicTree(
        produce((root) => {
          for (const msg of messages) {
            const segments = msg.topic.split("/");
            let current = root;

            for (let i = 0; i < segments.length; i++) {
              const segment = segments[i];
              if (!current.children[segment]) {
                const fullTopic = segments.slice(0, i + 1).join("/");
                current.children[segment] = {
                  segment,
                  fullTopic,
                  children: {},
                  messageCount: 0,
                  lastMessage: null,
                  lastUpdated: 0,
                };
                newTopics.push(fullTopic);
              }
              current = current.children[segment];
            }

            current.messageCount++;
            current.lastMessage = msg as MqttMessage;
            current.lastUpdated = msg.timestamp;
          }
        })
      );
      setTotalMessages((n) => n + messages.length);
      msgCountWindows.set(connectionName, (msgCountWindows.get(connectionName) ?? 0) + messages.length);
      updateRate(connectionName);
      return newTopics;
    },

    clearTree() {
      setTopicTree(createRootNode());
      setTotalMessages(0);
      setMessagesPerSecond(new Map());
      msgCountWindows.clear();
      lastRateUpdates.clear();
    },

    clearSubtree(topic: string) {
      const segments = topic.split("/");
      if (segments.length === 0) return;

      setTopicTree(
        produce((root) => {
          let current = root;
          // Navigate to parent of target node
          for (let i = 0; i < segments.length - 1; i++) {
            if (!current.children[segments[i]]) return;
            current = current.children[segments[i]];
          }
          // Delete the target node
          delete current.children[segments[segments.length - 1]];
        })
      );
    },
  };
}
