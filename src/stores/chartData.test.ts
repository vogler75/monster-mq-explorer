import { describe, expect, it } from "vitest";
import { createChartDataStore, seriesKey } from "./chartData";

describe("chart data store", () => {
  it("continues collecting data after Clear for pinned topics", () => {
    const store = createChartDataStore();
    const topic = "broker/sensor";
    store.initSeries(new Set([topic]));
    store.setChartActive(true);
    store.pushMessage(topic, new TextEncoder().encode("1"), 1_000);

    store.clearAll();
    store.pushMessage(topic, new TextEncoder().encode("2"), 2_000);

    expect(store.getSeriesArrays(seriesKey(topic))).toEqual({ timestamps: [2_000], values: [2] });
  });
});
