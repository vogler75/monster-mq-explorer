import { describe, expect, it } from "vitest";
import { createRootNode, flattenVisibleNodes, getNodeByTopic, insertMessage, removeTopic } from "./topic-tree";

describe("topic tree", () => {
  it("marks a browsed node with unloaded children as expandable", () => {
    const root = createRootNode();
    root.children.connection = {
      segment: "connection",
      fullTopic: "connection",
      children: {},
      messageCount: 0,
      lastMessage: null,
      lastUpdated: 0,
      isBrowsed: true,
      browsedChildren: false,
    };

    expect(flattenVisibleNodes(root, new Set())).toMatchObject([{ key: "connection", hasChildren: true }]);
  });

  it("removes a leaf topic and prunes empty parent nodes up to root", () => {
    const root = createRootNode();
    insertMessage(root, {
      topic: "conn/sensors/temperature",
      payload: new TextEncoder().encode("23.5"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });

    expect(getNodeByTopic(root, "conn/sensors/temperature")).not.toBeNull();

    // Send empty payload (0-size)
    insertMessage(root, {
      topic: "conn/sensors/temperature",
      payload: new Uint8Array(0),
      qos: 0,
      retain: false,
      timestamp: 2000,
    });

    expect(getNodeByTopic(root, "conn/sensors/temperature")).toBeNull();
    expect(getNodeByTopic(root, "conn/sensors")).toBeNull();
    expect(getNodeByTopic(root, "conn")).toBeNull();
    expect(Object.keys(root.children)).toHaveLength(0);
  });

  it("removes a leaf topic while preserving siblings and non-empty ancestor nodes", () => {
    const root = createRootNode();
    insertMessage(root, {
      topic: "conn/sensors/temperature",
      payload: new TextEncoder().encode("23.5"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });
    insertMessage(root, {
      topic: "conn/sensors/humidity",
      payload: new TextEncoder().encode("45%"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });

    // Remove temperature
    removeTopic(root, "conn/sensors/temperature");

    expect(getNodeByTopic(root, "conn/sensors/temperature")).toBeNull();
    expect(getNodeByTopic(root, "conn/sensors/humidity")).not.toBeNull();
    expect(getNodeByTopic(root, "conn/sensors")).not.toBeNull();
    expect(getNodeByTopic(root, "conn")).not.toBeNull();
  });

  it("clears lastMessage when a branch node receives a 0-size payload but has children", () => {
    const root = createRootNode();
    insertMessage(root, {
      topic: "conn/sensors",
      payload: new TextEncoder().encode("active"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });
    insertMessage(root, {
      topic: "conn/sensors/temperature",
      payload: new TextEncoder().encode("23.5"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });

    // Remove conn/sensors with 0-size payload
    insertMessage(root, {
      topic: "conn/sensors",
      payload: new Uint8Array([]),
      qos: 0,
      retain: false,
      timestamp: 2000,
    });

    const sensorsNode = getNodeByTopic(root, "conn/sensors");
    expect(sensorsNode).not.toBeNull();
    expect(sensorsNode?.lastMessage).toBeNull();
    expect(getNodeByTopic(root, "conn/sensors/temperature")).not.toBeNull();
  });

  it("does not prune browsed ancestors when topic is removed", () => {
    const root = createRootNode();
    root.children.conn = {
      segment: "conn",
      fullTopic: "conn",
      children: {},
      messageCount: 0,
      lastMessage: null,
      lastUpdated: 0,
      isBrowsed: true,
    };

    insertMessage(root, {
      topic: "conn/sensors/temperature",
      payload: new TextEncoder().encode("23.5"),
      qos: 0,
      retain: true,
      timestamp: 1000,
    });

    removeTopic(root, "conn/sensors/temperature");

    expect(getNodeByTopic(root, "conn/sensors/temperature")).toBeNull();
    expect(getNodeByTopic(root, "conn/sensors")).toBeNull();
    // Conn is browsed, so it should stay
    expect(getNodeByTopic(root, "conn")).not.toBeNull();
  });
});

