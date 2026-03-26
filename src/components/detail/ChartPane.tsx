import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useWatchlist } from "../../stores/watchlist";
import { useChartData } from "../../stores/chartData";
import { useMessageLog } from "../../stores/messageLog";
import { collectJsonPaths } from "../../lib/jsonPath";
import type { PathConfig } from "../../lib/jsonPath";

/**
 * Build a short but unique label for a topic within a set of topics.
 * Uses only as many trailing segments as needed to distinguish all topics.
 * e.g. ["a/b/watt", "a/c/watt"] → ["b/watt", "c/watt"]
 */
function shortLabels(topics: string[]): Map<string, string> {
  const result = new Map<string, string>();
  // Start with 1 trailing segment, increase until all labels are unique
  for (let segs = 1; segs <= 10; segs++) {
    result.clear();
    const seen = new Map<string, number>(); // label → count
    for (const t of topics) {
      const parts = t.split("/");
      const label = parts.slice(-segs).join("/");
      result.set(t, label);
      seen.set(label, (seen.get(label) || 0) + 1);
    }
    const allUnique = [...seen.values()].every((c) => c === 1);
    if (allUnique || segs >= topics[0]?.split("/").length) break;
  }
  return result;
}

const SERIES_COLORS = [
  "#60a5fa", // blue-400
  "#34d399", // emerald-400
  "#f59e0b", // amber-400
  "#f87171", // red-400
  "#a78bfa", // violet-400
  "#22d3ee", // cyan-400
  "#fb923c", // orange-400
  "#e879f9", // fuchsia-400
];

interface TopicConfigPillProps {
  topic: string;
  label: string;
  config: PathConfig;
  onConfigChange: (newConfig: PathConfig) => void;
  suggestedPaths: string[];
}

function TopicConfigPill(props: TopicConfigPillProps) {
  const [showPopover, setShowPopover] = createSignal(false);
  const [mode, setMode] = createSignal<"raw" | "path">(props.config.mode);
  const [path, setPath] = createSignal(props.config.path);
  const [filteredPaths, setFilteredPaths] = createSignal<string[]>([]);
  const [showSuggestions, setShowSuggestions] = createSignal(false);

  let pillRef!: HTMLDivElement;

  const topicLabel = () => props.label || props.topic;

  function handleModeChange(newMode: "raw" | "path") {
    setMode(newMode);
    props.onConfigChange({ mode: newMode, path: newMode === "raw" ? "" : path() });
  }

  function handlePathChange(newPath: string) {
    setPath(newPath);
    props.onConfigChange({ mode: "path", path: newPath });

    // Filter suggestions
    const filtered = props.suggestedPaths.filter((p) =>
      p.toLowerCase().includes(newPath.toLowerCase())
    );
    setFilteredPaths(filtered);
    setShowSuggestions(filtered.length > 0);
  }

  function selectSuggestion(suggestion: string) {
    handlePathChange(suggestion);
    setShowSuggestions(false);
  }

  // Close popover when clicking outside (but the fixed backdrop handles most of this)
  onMount(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowPopover(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => document.removeEventListener("keydown", handleEscape));
  });

  return (
    <div class="relative">
      <button
        ref={pillRef}
        class="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors flex-shrink-0 whitespace-nowrap"
        onClick={() => setShowPopover(!showPopover())}
      >
        {topicLabel()}
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
                  "bg-blue-600 text-white": mode() === "raw",
                  "bg-slate-700 text-slate-300 hover:bg-slate-600": mode() !== "raw",
                }}
                onClick={() => handleModeChange("raw")}
              >
                Raw
              </button>
              <button
                class="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
                classList={{
                  "bg-blue-600 text-white": mode() === "path",
                  "bg-slate-700 text-slate-300 hover:bg-slate-600": mode() !== "path",
                }}
                onClick={() => handleModeChange("path")}
              >
                Path
              </button>
            </div>
          </div>

          {/* Path input */}
          <Show when={mode() === "path"}>
            <div class="relative">
              <div class="text-xs text-slate-400 mb-1">JSON Path</div>
              <input
                type="text"
                placeholder="e.g., temperature"
                value={path()}
                onInput={(e) => handlePathChange(e.currentTarget.value)}
                class="w-full px-2 py-1.5 text-xs bg-slate-700 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <Show when={showSuggestions()}>
                <div class="absolute top-full mt-1 left-0 right-0 bg-slate-700 border border-slate-600 rounded shadow-md max-h-32 overflow-y-auto z-50">
                  {filteredPaths().map((p) => (
                    <button
                      type="button"
                      class="w-full text-left px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-600 transition-colors"
                      onClick={() => selectSuggestion(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default function ChartPane() {
  const { pinnedTopics } = useWatchlist();
  const { getSeriesArrays, seriesVersion, maxPoints, setMaxPoints, clearAll, getTopicConfig, updateTopicConfig } = useChartData();
  const { liveTopics } = useMessageLog();

  let containerRef!: HTMLDivElement;
  let uplotInstance: uPlot | undefined;

  const pinnedList = createMemo(() => [...pinnedTopics()]);
  const labels = createMemo(() => shortLabels(pinnedList()));

  // Collect suggested paths for a topic
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

  // Build uplot options for dark theme
  function buildOpts(topics: string[], container: HTMLDivElement): uPlot.Options {
    const rect = container.getBoundingClientRect();
    const lbls = labels();
    return {
      width: rect.width,
      height: rect.height,
      series: [
        {}, // x-axis (timestamps)
        ...topics.map((topic, i) => ({
          label: lbls.get(topic) || topic,
          stroke: SERIES_COLORS[i % SERIES_COLORS.length],
          width: 1.5,
        })),
      ],
      axes: [
        {
          stroke: "#64748b",
          ticks: { stroke: "#1e293b" },
          grid: { stroke: "#1e293b" },
        },
        {
          stroke: "#64748b",
          ticks: { stroke: "#1e293b" },
          grid: { stroke: "#1e293b" },
        },
      ],
      scales: {
        x: { time: true },
      },
      cursor: { stroke: "#94a3b8", width: 1 },
      legend: { show: true },
    };
  }

  // Build data for uplot: merged x-axis with all series.
  // Uses undefined (not null) for missing points so uplot connects
  // through them instead of drawing gaps.
  function buildData(topics: string[]): uPlot.AlignedData {
    if (topics.length === 0) return [[]];

    // Collect all timestamps and merge into a unified x-axis
    const allTs = new Set<number>();
    const seriesMap = new Map<string, { timestamps: number[]; values: number[] }>();

    for (const topic of topics) {
      const data = getSeriesArrays(topic);
      if (data) {
        seriesMap.set(topic, data);
        for (const t of data.timestamps) allTs.add(t);
      }
    }

    const xs = [...allTs].sort((a, b) => a - b);

    // Map each topic to the unified x-axis.
    // undefined = "no data at this timestamp, connect through it"
    // null      = "gap, break the line" (we don't want this)
    const ys = topics.map((topic) => {
      const data = seriesMap.get(topic);
      if (!data) return xs.map(() => undefined);
      const map = new Map(data.timestamps.map((t, i) => [t, data.values[i]]));
      return xs.map((t) => map.has(t) ? map.get(t)! : undefined);
    });

    // Convert timestamps from ms to Unix seconds
    return [xs.map((t) => t / 1000), ...ys] as uPlot.AlignedData;
  }

  onMount(() => {
    if (!containerRef) return;

    // Defer initial creation so the container has its final layout dimensions
    requestAnimationFrame(() => {
      const topics = pinnedList();
      const opts = buildOpts(topics, containerRef);
      const data = buildData(topics);
      uplotInstance = new uPlot(opts, data, containerRef);
    });

    // Resize observer — keeps canvas matched to container size
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

  // Redraw on new data points
  createEffect(() => {
    seriesVersion(); // track changes
    if (!uplotInstance) return;
    const data = buildData(pinnedList());
    uplotInstance.setData(data);
  });

  // Rebuild when series list changes
  createEffect(() => {
    const topics = pinnedList();
    if (!uplotInstance || !containerRef) return;
    uplotInstance.destroy();
    const opts = buildOpts(topics, containerRef);
    const data = buildData(topics);
    uplotInstance = new uPlot(opts, data, containerRef);
  });

  const hasData = createMemo(() => {
    for (const topic of pinnedList()) {
      const data = getSeriesArrays(topic);
      if (data && data.timestamps.length > 0) return true;
    }
    return false;
  });

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
            {pinnedList().map((topic) => (
              <TopicConfigPill
                topic={topic}
                label={labels().get(topic) || topic}
                config={getTopicConfig(topic)}
                onConfigChange={(newConfig) => {
                  updateTopicConfig(topic, newConfig);
                }}
                suggestedPaths={getSuggestedPaths(topic)}
              />
            ))}

            <div class="flex-1" />

            {/* Right side controls */}
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

      {/* Chart container — relative wrapper so the canvas + overlay stack correctly */}
      <div class="flex-1 relative min-h-0" style={{ "background-color": "rgb(10, 15, 30)" }}>
        <div
          ref={containerRef}
          class="absolute inset-0"
        />

        <Show when={!hasData()}>
          <div class="absolute inset-0 flex items-center justify-center text-slate-500 text-sm pointer-events-none z-10">
            Waiting for data...
          </div>
        </Show>
      </div>
    </div>
  );
}
