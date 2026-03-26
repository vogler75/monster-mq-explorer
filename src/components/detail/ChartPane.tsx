import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useWatchlist } from "../../stores/watchlist";
import { useChartData, seriesKey } from "../../stores/chartData";
import { useMessageLog } from "../../stores/messageLog";
import { collectJsonPaths, extractValue } from "../../lib/jsonPath";

/**
 * Build a short but unique label for a topic within a set of topics.
 * Uses only as many trailing segments as needed to distinguish all topics.
 */
function shortLabels(topics: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let segs = 1; segs <= 10; segs++) {
    result.clear();
    const seen = new Map<string, number>();
    for (const t of topics) {
      const parts = t.split("/");
      const label = parts.slice(-segs).join("/");
      result.set(t, label);
      seen.set(label, (seen.get(label) || 0) + 1);
    }
    const allUnique = [...seen.values()].every((c) => c === 1);
    if (allUnique || segs >= (topics[0]?.split("/").length ?? 1)) break;
  }
  return result;
}

const SERIES_COLORS = [
  "#60a5fa", "#34d399", "#f59e0b", "#f87171",
  "#a78bfa", "#22d3ee", "#fb923c", "#e879f9",
];

/** Build a display label for a series key */
function seriesLabel(key: string, topicLabels: Map<string, string>): string {
  const sep = key.indexOf("\0");
  if (sep === -1) {
    return topicLabels.get(key) || key;
  }
  const topic = key.slice(0, sep);
  const path = key.slice(sep + 1);
  const tl = topicLabels.get(topic) || topic;
  return `${tl}.${path}`;
}

// ── TopicConfigPill ─────────────────────────────────────────────────

interface TopicConfigPillProps {
  topic: string;
  label: string;
  colorIndex: number;
  seriesCount: number;
  hasError: boolean;
  mode: "raw" | "path";
  selectedPaths: string[];
  suggestedPaths: string[];
  onModeChange: (mode: "raw" | "path") => void;
  onTogglePath: (path: string) => void;
}

function TopicConfigPill(props: TopicConfigPillProps) {
  const [showPopover, setShowPopover] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  let pillRef!: HTMLDivElement;

  const filteredPaths = () => {
    const f = filter().toLowerCase();
    return f
      ? props.suggestedPaths.filter((p) => p.toLowerCase().includes(f))
      : props.suggestedPaths;
  };

  onMount(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPopover(false);
    }
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => document.removeEventListener("keydown", handleEscape));
  });

  // Color swatch: show first assigned color for this topic
  const pillColor = () => SERIES_COLORS[props.colorIndex % SERIES_COLORS.length];

  return (
    <div class="relative">
      <button
        ref={pillRef}
        class="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors flex-shrink-0 whitespace-nowrap flex items-center gap-1.5"
        onClick={() => setShowPopover(!showPopover())}
      >
        <span class="inline-block w-3 h-2 rounded-sm flex-shrink-0" style={{ "background-color": pillColor() }} />
        {props.label}
        {props.mode === "path" && props.selectedPaths.length > 0 && (
          <span class="text-slate-400">({props.selectedPaths.length})</span>
        )}
        {props.hasError && (
          <span class="text-amber-400 flex-shrink-0" title="Cannot convert payload to number — configure JSON path">&#x26A0;</span>
        )}
      </button>

      <Show when={showPopover()}>
        <div class="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
        <div
          class="fixed z-50 bg-slate-800 border border-slate-600 rounded shadow-xl p-3 w-72"
          style={{
            top: `${pillRef.getBoundingClientRect().bottom + 8}px`,
            left: `${Math.max(8, Math.min(window.innerWidth - 288 - 8, pillRef.getBoundingClientRect().left))}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mode selector */}
          <div class="mb-3">
            <div class="text-xs text-slate-400 mb-1.5">Mode</div>
            <div class="flex gap-2">
              <button
                class="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
                classList={{
                  "bg-blue-600 text-white": props.mode === "raw",
                  "bg-slate-700 text-slate-300 hover:bg-slate-600": props.mode !== "raw",
                }}
                onClick={() => props.onModeChange("raw")}
              >
                Raw
              </button>
              <button
                class="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
                classList={{
                  "bg-blue-600 text-white": props.mode === "path",
                  "bg-slate-700 text-slate-300 hover:bg-slate-600": props.mode !== "path",
                }}
                onClick={() => props.onModeChange("path")}
              >
                Path
              </button>
            </div>
          </div>

          {/* Path selection (checkboxes) */}
          <Show when={props.mode === "path"}>
            <div>
              <div class="text-xs text-slate-400 mb-1">Select fields</div>
              {/* Filter input */}
              <Show when={props.suggestedPaths.length > 5}>
                <input
                  type="text"
                  placeholder="Filter fields..."
                  value={filter()}
                  onInput={(e) => setFilter(e.currentTarget.value)}
                  class="w-full px-2 py-1.5 text-xs bg-slate-700 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-2"
                />
              </Show>
              {/* Checkbox list */}
              <div class="max-h-48 overflow-y-auto space-y-0.5">
                <Show
                  when={filteredPaths().length > 0}
                  fallback={
                    <div class="text-xs text-slate-500 py-1">No JSON fields found in payload</div>
                  }
                >
                  <For each={filteredPaths()}>
                    {(p) => {
                      const checked = () => props.selectedPaths.includes(p);
                      // Color for this specific path's series
                      const pathColorIdx = () => {
                        if (!checked()) return 0;
                        // Find position in all series for consistent color
                        return props.colorIndex + props.selectedPaths.indexOf(p);
                      };
                      return (
                        <label class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-700/50 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={checked()}
                            onChange={() => props.onTogglePath(p)}
                            class="accent-blue-500"
                          />
                          <span
                            class="inline-block w-2.5 h-1.5 rounded-sm flex-shrink-0"
                            style={{ "background-color": checked() ? SERIES_COLORS[pathColorIdx() % SERIES_COLORS.length] : "#475569" }}
                          />
                          <span class="text-slate-200 truncate">{p}</span>
                        </label>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── ChartPane ───────────────────────────────────────────────────────

export default function ChartPane() {
  const { pinnedTopics } = useWatchlist();
  const {
    getSeriesArrays, seriesVersion, configVersion,
    maxPoints, setMaxPoints, clearAll,
    getTopicConfig, updateTopicConfig, getAllSeriesKeys,
  } = useChartData();
  const { liveTopics } = useMessageLog();

  let containerRef!: HTMLDivElement;
  let uplotInstance: uPlot | undefined;

  const pinnedList = createMemo(() => [...pinnedTopics()]);
  const topicLabels = createMemo(() => shortLabels(pinnedList()));

  // All series keys (recomputed when config or pinned topics change)
  const allKeys = createMemo(() => {
    configVersion(); // track config changes
    return getAllSeriesKeys(pinnedList());
  });

  const getSuggestedPaths = (topic: string): string[] => {
    const msg = liveTopics[topic];
    if (!msg) return [];
    try {
      const text = new TextDecoder().decode(msg.payload);
      const obj = JSON.parse(text);
      return collectJsonPaths(obj);
    } catch {
      return [];
    }
  };

  const topicHasError = (topic: string): boolean => {
    const msg = liveTopics[topic];
    if (!msg) return false;
    const config = getTopicConfig(topic);
    if (config.mode === "raw") {
      return extractValue(msg.payload, { mode: "raw", path: "" }) === null;
    }
    // Path mode: error if no paths selected, or none of them extract a value
    if (config.paths.length === 0) return true;
    return config.paths.every(
      (p) => extractValue(msg.payload, { mode: "path", path: p }) === null
    );
  };

  // ── uPlot helpers ──

  function buildOpts(keys: string[], container: HTMLDivElement): uPlot.Options {
    const rect = container.getBoundingClientRect();
    const lbls = topicLabels();
    return {
      width: rect.width,
      height: rect.height,
      series: [
        {},
        ...keys.map((key, i) => ({
          label: seriesLabel(key, lbls),
          stroke: SERIES_COLORS[i % SERIES_COLORS.length],
          width: 1.5,
        })),
      ],
      axes: [
        { stroke: "#64748b", ticks: { stroke: "#1e293b" }, grid: { stroke: "#1e293b" } },
        { stroke: "#64748b", ticks: { stroke: "#1e293b" }, grid: { stroke: "#1e293b" } },
      ],
      scales: { x: { time: true } },
      cursor: { stroke: "#94a3b8", width: 1 },
      legend: { show: true },
    };
  }

  function buildData(keys: string[]): uPlot.AlignedData {
    if (keys.length === 0) return [[]];

    const allTs = new Set<number>();
    const seriesMap = new Map<string, { timestamps: number[]; values: number[] }>();

    for (const key of keys) {
      const data = getSeriesArrays(key);
      if (data) {
        seriesMap.set(key, data);
        for (const t of data.timestamps) allTs.add(t);
      }
    }

    const xs = [...allTs].sort((a, b) => a - b);

    const ys = keys.map((key) => {
      const data = seriesMap.get(key);
      if (!data) return xs.map(() => undefined);
      const map = new Map(data.timestamps.map((t, i) => [t, data.values[i]]));
      return xs.map((t) => map.has(t) ? map.get(t)! : undefined);
    });

    return [xs.map((t) => t / 1000), ...ys] as uPlot.AlignedData;
  }

  // ── uPlot lifecycle ──

  onMount(() => {
    if (!containerRef) return;

    requestAnimationFrame(() => {
      const keys = allKeys();
      uplotInstance = new uPlot(buildOpts(keys, containerRef), buildData(keys), containerRef);
    });

    const ro = new ResizeObserver(([entry]) => {
      if (!uplotInstance) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        uplotInstance.setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    ro.observe(containerRef);

    onCleanup(() => {
      ro.disconnect();
      uplotInstance?.destroy();
      uplotInstance = undefined;
    });
  });

  // Redraw on new data
  createEffect(() => {
    seriesVersion();
    if (!uplotInstance) return;
    uplotInstance.setData(buildData(allKeys()));
  });

  // Rebuild chart when series list changes (topics or paths added/removed)
  createEffect(() => {
    const keys = allKeys();
    if (!uplotInstance || !containerRef) return;
    uplotInstance.destroy();
    uplotInstance = new uPlot(buildOpts(keys, containerRef), buildData(keys), containerRef);
  });

  // ── Compute color index offset per topic ──
  // Each topic's series start at a running color offset so colors don't collide
  const topicColorOffset = createMemo(() => {
    configVersion();
    const offsets = new Map<string, number>();
    let idx = 0;
    for (const topic of pinnedList()) {
      offsets.set(topic, idx);
      const config = getTopicConfig(topic);
      idx += config.mode === "raw" ? 1 : Math.max(1, config.paths.length);
    }
    return offsets;
  });

  // ── Render ──

  return (
    <div class="flex flex-col h-full bg-slate-900">
      {/* Config bar */}
      <div class="flex-shrink-0 px-3 py-2 border-b border-slate-700 bg-slate-800/40 flex items-center gap-2 overflow-x-auto min-h-0">
        <Show
          when={pinnedList().length > 0}
          fallback={
            <div class="text-xs text-slate-500">
              No pinned topics. Pin topics from the message table to chart them.
            </div>
          }
        >
          <>
            {pinnedList().map((topic) => {
              const config = () => { configVersion(); return getTopicConfig(topic); };
              return (
                <TopicConfigPill
                  topic={topic}
                  label={topicLabels().get(topic) || topic}
                  colorIndex={topicColorOffset().get(topic) || 0}
                  seriesCount={config().mode === "raw" ? 1 : config().paths.length}
                  hasError={topicHasError(topic)}
                  mode={config().mode}
                  selectedPaths={config().paths}
                  suggestedPaths={getSuggestedPaths(topic)}
                  onModeChange={(mode) => {
                    const cur = getTopicConfig(topic);
                    updateTopicConfig(topic, mode, mode === "raw" ? [] : cur.paths);
                  }}
                  onTogglePath={(path) => {
                    const cur = getTopicConfig(topic);
                    const paths = cur.paths.includes(path)
                      ? cur.paths.filter((p) => p !== path)
                      : [...cur.paths, path];
                    updateTopicConfig(topic, "path", paths);
                  }}
                />
              );
            })}

            <div class="flex-1" />

            <div class="flex items-center gap-2 flex-shrink-0">
              <label class="flex items-center gap-1.5 text-xs">
                <span class="text-slate-400">Max points:</span>
                <input
                  type="number"
                  value={maxPoints()}
                  onInput={(e) => setMaxPoints(Math.max(10, parseInt(e.currentTarget.value) || 1000))}
                  class="w-16 px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  min="10"
                  max="10000"
                />
              </label>
              <button
                onClick={() => clearAll()}
                class="px-2.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
              >
                Clear
              </button>
            </div>
          </>
        </Show>
      </div>

      {/* Chart container */}
      <div class="flex-1 relative min-h-0" style={{ "background-color": "rgb(10, 15, 30)" }}>
        <div ref={containerRef} class="absolute inset-0" />
      </div>
    </div>
  );
}
