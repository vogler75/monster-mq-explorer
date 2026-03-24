import type { TopicNode, FlatTreeNode, MqttMessage } from "../types/mqtt";

export function createRootNode(): TopicNode {
  return {
    segment: "",
    fullTopic: "",
    children: {},
    messageCount: 0,
    lastMessage: null,
    lastUpdated: 0,
  };
}

export function insertMessage(
  root: TopicNode,
  message: MqttMessage
): void {
  const segments = message.topic.split("/");
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
  current.lastMessage = message;
  current.lastUpdated = message.timestamp;
}

export function flattenVisibleNodes(
  root: TopicNode,
  expandedSet: Set<string>,
  sorted: boolean = false
): FlatTreeNode[] {
  const result: FlatTreeNode[] = [];

  function walk(node: TopicNode, depth: number) {
    const childKeys = sorted
      ? Object.keys(node.children).sort((a, b) => a.localeCompare(b))
      : Object.keys(node.children);

    for (const key of childKeys) {
      const child = node.children[key];
      const hasChildren = Object.keys(child.children).length > 0;
      const isExpanded = expandedSet.has(child.fullTopic);

      result.push({
        node: child,
        depth,
        hasChildren,
        isExpanded,
        key: child.fullTopic,
      });

      if (isExpanded && hasChildren) {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return result;
}

export function getNodeByTopic(
  root: TopicNode,
  topic: string
): TopicNode | null {
  const segments = topic.split("/");
  let current = root;

  for (const segment of segments) {
    if (!current.children[segment]) return null;
    current = current.children[segment];
  }

  return current;
}

export function countDescendants(node: TopicNode): number {
  let count = node.messageCount;
  for (const child of Object.values(node.children)) {
    count += countDescendants(child);
  }
  return count;
}

export function collectRetainedTopics(node: TopicNode): string[] {
  const result: string[] = [];

  function walk(n: TopicNode) {
    if (n.lastMessage?.retain && n.fullTopic) {
      result.push(n.fullTopic);
    }
    for (const child of Object.values(n.children)) {
      walk(child);
    }
  }

  walk(node);
  return result;
}
