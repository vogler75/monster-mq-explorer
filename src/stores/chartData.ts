import { createSignal } from "solid-js";
import type { PathConfig } from "../lib/jsonPath";
import { extractValue } from "../lib/jsonPath";

const MAX_DEFAULT = 1000;

export interface TopicChartConfig {
  topic: string;
  pathConfig: PathConfig;
}

export interface TopicSeries {
  topic: string;
  timestamps: Float64Array;
  values: Float64Array;
  head: number;
  count: number;
}

// Singleton module-level state
const [chartActive, setChartActive] = createSignal(false);
const [maxPoints, setMaxPoints] = createSignal(MAX_DEFAULT);

// Plain objects (not Solid stores) to avoid reactivity issues
// These are accessed synchronously from pushMessage
let topicConfigs: Record<string, TopicChartConfig> = {};
let seriesData: Record<string, TopicSeries> = {};

// Version counter to trigger chart redraws
const [seriesVersion, setSeriesVersion] = createSignal(0);

export function useChartData() {
  /**
   * Initializes series for all pinned topics.
   * Allocates ring buffers and default path configs.
   * Called when the chart view is activated.
   */
  function initSeries(pinnedTopics: Set<string>) {
    seriesData = {};
    topicConfigs = {};

    for (const topic of pinnedTopics) {
      ensureSeries(topic);
      topicConfigs[topic] = {
        topic,
        pathConfig: { mode: "raw", path: "" },
      };
    }
    setSeriesVersion(0);
  }

  /**
   * Ensures a TopicSeries exists for the given topic.
   * Idempotent: safe to call multiple times.
   */
  function ensureSeries(topic: string) {
    if (!seriesData[topic]) {
      const max = maxPoints();
      seriesData[topic] = {
        topic,
        timestamps: new Float64Array(max),
        values: new Float64Array(max),
        head: 0,
        count: 0,
      };
    }
    if (!topicConfigs[topic]) {
      topicConfigs[topic] = {
        topic,
        pathConfig: { mode: "raw", path: "" },
      };
    }
  }

  /**
   * Updates the path config for a topic and notify chart to redraw.
   */
  function updateTopicConfig(topic: string, pathConfig: PathConfig) {
    if (!topicConfigs[topic]) {
      topicConfigs[topic] = { topic, pathConfig };
    } else {
      topicConfigs[topic].pathConfig = pathConfig;
    }
    setSeriesVersion((v) => v + 1);
  }

  /**
   * Gets the current config for a topic (for UI binding).
   */
  function getTopicConfig(topic: string): PathConfig {
    return topicConfigs[topic]?.pathConfig || { mode: "raw", path: "" };
  }

  /**
   * Pushes a new message into the series ring buffer.
   * Only called when chartActive() is true.
   * This is called from the worker message handler - must be synchronous.
   */
  function pushMessage(
    topic: string,
    payload: Uint8Array,
    timestamp: number
  ) {
    if (!chartActive()) return;

    const config = topicConfigs[topic];
    if (!config) return; // topic not configured

    const value = extractValue(payload, config.pathConfig);
    if (value === null) return; // could not extract numeric value

    let series = seriesData[topic];
    if (!series) return; // series must be initialized via initSeries/ensureSeries

    const max = maxPoints();
    series.timestamps[series.head % max] = timestamp;
    series.values[series.head % max] = value;
    series.head++;
    if (series.count < max) series.count++;

    setSeriesVersion((v) => v + 1);
  }

  /**
   * Extracts the logical chronological sequence from a topic's ring buffer.
   * Returns plain arrays suitable for uplot consumption.
   * Returns null if the topic has no series.
   */
  function getSeriesArrays(
    topic: string
  ): { timestamps: number[]; values: number[] } | null {
    const series = seriesData[topic];
    if (!series || series.count === 0) return null;

    const max = maxPoints();
    const timestamps: number[] = [];
    const values: number[] = [];

    // Extract the logical sequence in chronological order
    const startIdx = series.head - series.count;
    for (let i = 0; i < series.count; i++) {
      const idx = (startIdx + i) % max;
      timestamps.push(series.timestamps[idx]);
      values.push(series.values[idx]);
    }

    return { timestamps, values };
  }

  /**
   * Clears all series data and resets the version counter.
   * Called when the chart is deactivated.
   */
  function clearAll() {
    seriesData = {};
    topicConfigs = {};
    setSeriesVersion(0);
  }

  return {
    chartActive,
    setChartActive,
    maxPoints,
    setMaxPoints,
    seriesVersion,
    initSeries,
    ensureSeries,
    pushMessage,
    getSeriesArrays,
    getTopicConfig,
    updateTopicConfig,
    clearAll,
  };
}
