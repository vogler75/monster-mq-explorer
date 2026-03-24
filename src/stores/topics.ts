import { createSignal, batch } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { TopicNode, MqttMessage } from "../types/mqtt";
import type { SerializedMessage } from "../workers/mqtt.protocol";
import { createRootNode } from "../lib/topic-tree";

const [topicTree, setTopicTree] = createStore<TopicNode>(createRootNode());
const [totalMessages, setTotalMessages] = createSignal(0);
const [messagesPerSecond, setMessagesPerSecond] = createSignal(0);

// Track message rate
let msgCountWindow = 0;
let lastRateUpdate = Date.now();

function updateRate() {
  const now = Date.now();
  const elapsed = (now - lastRateUpdate) / 1000;
  if (elapsed >= 1) {
    setMessagesPerSecond(Math.round(msgCountWindow / elapsed));
    msgCountWindow = 0;
    lastRateUpdate = now;
  }
}

export function useTopicTree() {
  return {
    topicTree,
    totalMessages,
    messagesPerSecond,

    processBatch(messages: SerializedMessage[]) {
      batch(() => {
        setTopicTree(
          produce((root) => {
            for (const msg of messages) {
              const segments = msg.topic.split("/");
              let current = root;

              for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                if (!current.children[segment]) {
                  current.children[segment] = {
                    segment,
                    fullTopic: segments.slice(0, i + 1).join("/"),
                    children: {},
                    messageCount: 0,
                    lastMessage: null,
                    lastUpdated: 0,
                  };
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
      });
      msgCountWindow += messages.length;
      updateRate();
    },

    clearTree() {
      setTopicTree(createRootNode());
      setTotalMessages(0);
      setMessagesPerSecond(0);
      msgCountWindow = 0;
      lastRateUpdate = Date.now();
    },
  };
}
