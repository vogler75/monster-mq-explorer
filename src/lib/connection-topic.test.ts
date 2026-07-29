import { describe, expect, it } from "vitest";
import { stripConnectionPrefix } from "./connection-topic";

describe("stripConnectionPrefix", () => {
  it("removes the UI-only connection prefix before a broker operation", () => {
    expect(stripConnectionPrefix("Plant MQTT/area/temperature", "Plant MQTT")).toBe("area/temperature");
  });

  it("does not alter a broker topic that merely shares the connection-name text", () => {
    expect(stripConnectionPrefix("Plant MQTT Backup/area/temperature", "Plant MQTT")).toBe(
      "Plant MQTT Backup/area/temperature",
    );
  });

  it("preserves a topic when no connection can be resolved", () => {
    expect(stripConnectionPrefix("/area/temperature", "")).toBe("/area/temperature");
  });
});
