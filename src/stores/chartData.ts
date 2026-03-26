import { createSignal } from "solid-js";
import { extractValue, collectJsonPaths } from "../lib/jsonPath";
import type { PathConfig } from "../lib/jsonPath";

const MAX_DEFAULT = 1000;

export interface TopicChartConfig {
  topic: string;
  mode: "raw" | "path";
  paths: string[]; // selected JSON paths (used when mode === "path")
}

export interface TopicSeries {
  key: string; // series key: topic for raw, topic\0path for path mode
  timestamps: Float64Array;
  values: Float64Array;
  head: number;
  count: number;
}

// Singleton module-level state
const [chartActive, setChartActive] = createSignal(false);
const [maxPoints, setMaxPoints] = createSignal(MAX_DEFAULT);

// Plain objects (not Solid stores) to avoid reactivity issues
let topicConfigs: Record<string, TopicChartConfig> = {};
let seriesData: Record<string, TopicSeries> = {};

// Version counter to trigger chart redraws + config version for UI
const [seriesVersion, setSeriesVersion] = createSignal(0);
const [configVersion, setConfigVersion] = createSignal(0);

/** Build a series key from topic + optional path */
export function seriesKey(topic: string, path?: string): string {
  return path ? `${topic}\0${path}` : topic;
}

/** Get all series keys for a topic based on its config */
function seriesKeysForTopic(topic: string): string[] {
  const config = topicConfigs[topic];
  if (!config) return [];
  if (config.mode === "raw") return [seriesKey(topic)];
  return config.paths.map((p) => seriesKey(topic, p));
}

function allocSeries(key: string) {
  if (seriesData[key]) return;
  const max = maxPoints();
  seriesData[key] = {
    key,
    timestamps: new Float64Array(max),
    values: new Float64Array(max),
    head: 0,
    count: 0,
  };
}

/**
 * Auto-detect config for a topic based on its latest payload.
 * If the payload is a raw number, use raw mode.
 * If it's JSON and has a "value" field (case-insensitive), auto-select it as path mode.
 */
function autoDetectConfig(payload: Uint8Array | undefined): { mode: "raw" | "path"; paths: string[] } {
  if (!payload) return { mode: "raw", paths: [] };

  // Try raw first — if it parses as a number, use raw mode
  const rawVal = extractValue(payload, { mode: "raw", path: "" });
  if (rawVal !== null) return { mode: "raw", paths: [] };

  // Try JSON — look for a "value" field (case-insensitive)
  try {
    const text = new TextDecoder().decode(payload);
    const obj = JSON.parse(text);
    const allPaths = collectJsonPaths(obj);
    const valuePath = allPaths.find((p) => p.toLowerCase() === "value");
    if (valuePath) {
      return { mode: "path", paths: [valuePath] };
    }
  } catch {
    // not JSON
  }

  return { mode: "raw", paths: [] };
}

export function useChartData() {
  function initSeries(pinnedTopics: Set<string>, getPayload?: (topic: string) => Uint8Array | undefined) {
    seriesData = {};
    topicConfigs = {};

    for (const topic of pinnedTopics) {
      const detected = autoDetectConfig(getPayload?.(topic));
      topicConfigs[topic] = { topic, ...detected };
      for (const key of seriesKeysForTopic(topic)) {
        allocSeries(key);
      }
    }
    setSeriesVersion(0);
    setConfigVersion(0);
  }

  function ensureSeries(topic: string, payload?: Uint8Array) {
    if (!topicConfigs[topic]) {
      const detected = autoDetectConfig(payload);
      topicConfigs[topic] = { topic, ...detected };
    }
    // Allocate ring buffers for all series of this topic
    for (const key of seriesKeysForTopic(topic)) {
      allocSeries(key);
    }
  }

  function updateTopicConfig(topic: string, mode: "raw" | "path", paths: string[]) {
    topicConfigs[topic] = { topic, mode, paths };
    // Allocate buffers for any new paths
    for (const key of seriesKeysForTopic(topic)) {
      allocSeries(key);
    }
    setConfigVersion((v) => v + 1);
    setSeriesVersion((v) => v + 1);
  }

  function getTopicConfig(topic: string): TopicChartConfig {
    return topicConfigs[topic] || { topic, mode: "raw", paths: [] };
  }

  /** Returns all series keys across all topics (in order for chart display) */
  function getAllSeriesKeys(pinnedTopics: string[]): string[] {
    const keys: string[] = [];
    for (const topic of pinnedTopics) {
      keys.push(...seriesKeysForTopic(topic));
    }
    return keys;
  }

  function pushMessage(topic: string, payload: Uint8Array, timestamp: number) {
    if (!chartActive()) return;

    const config = topicConfigs[topic];
    if (!config) return;

    const max = maxPoints();
    let wrote = false;

    if (config.mode === "raw") {
      const value = extractValue(payload, { mode: "raw", path: "" });
      if (value === null) return;
      const key = seriesKey(topic);
      const series = seriesData[key];
      if (!series) return;
      series.timestamps[series.head % max] = timestamp;
      series.values[series.head % max] = value;
      series.head++;
      if (series.count < max) series.count++;
      wrote = true;
    } else {
      // Path mode: extract each selected path
      for (const path of config.paths) {
        const value = extractValue(payload, { mode: "path", path });
        if (value === null) continue;
        const key = seriesKey(topic, path);
        const series = seriesData[key];
        if (!series) continue;
        series.timestamps[series.head % max] = timestamp;
        series.values[series.head % max] = value;
        series.head++;
        if (series.count < max) series.count++;
        wrote = true;
      }
    }

    if (wrote) setSeriesVersion((v) => v + 1);
  }

  function getSeriesArrays(key: string): { timestamps: number[]; values: number[] } | null {
    const series = seriesData[key];
    if (!series || series.count === 0) return null;

    const max = maxPoints();
    const timestamps: number[] = [];
    const values: number[] = [];

    const startIdx = series.head - series.count;
    for (let i = 0; i < series.count; i++) {
      const idx = (startIdx + i) % max;
      timestamps.push(series.timestamps[idx]);
      values.push(series.values[idx]);
    }

    return { timestamps, values };
  }

  function clearAll() {
    seriesData = {};
    topicConfigs = {};
    setSeriesVersion(0);
    setConfigVersion(0);
  }

  return {
    chartActive,
    setChartActive,
    maxPoints,
    setMaxPoints,
    seriesVersion,
    configVersion,
    initSeries,
    ensureSeries,
    pushMessage,
    getSeriesArrays,
    getAllSeriesKeys,
    getTopicConfig,
    updateTopicConfig,
    clearAll,
  };
}
