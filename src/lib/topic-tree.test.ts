import { describe, expect, it } from "vitest";
import { createRootNode, flattenVisibleNodes } from "./topic-tree";

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
});
