import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import uPlot from "uplot";
import { useWatchlist } from "../../stores/watchlist";
import { useChartData } from "../../stores/chartData";
import { useMessageLog } from "../../stores/messageLog";
import { collectJsonPaths } from "../../lib/jsonPath";
import type { PathConfig } from "../../lib/jsonPath";

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

  const topicLabel = props.topic.split("/").at(-1) || props.topic;

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

  // Close popover when clicking outside
  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pillRef && !pillRef.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  return (
    <div ref={pillRef} class="relative">
      <button
        class="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors flex-shrink-0"
        onClick={() => setShowPopover(!showPopover())}
      >
        {topicLabel}
      </button>

      <Show when={showPopover()}>
        <div
          class="absolute top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg p-3 w-64"
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
  const { topicConfigs, setTopicConfigs, getSeriesArrays, seriesVersion, maxPoints, setMaxPoints, clearAll } = useChartData();
  const { liveTopics } = useMessageLog();

  let containerRef!: HTMLDivElement;
  let uplotInstance: uPlot | undefined;

  const pinnedList = createMemo(() => [...pinnedTopics()]);

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
    return {
      width: rect.width,
      height: rect.height,
      series: [
        {}, // x-axis (timestamps)
        ...topics.map((topic, i) => ({
          label: topic.split("/").at(-1),
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

  // Build data for uplot: merged x-axis with all series
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

    // Map each topic to the unified x-axis
    const ys = topics.map((topic) => {
      const data = seriesMap.get(topic);
      if (!data) return xs.map(() => null);
      const map = new Map(data.timestamps.map((t, i) => [t, data.values[i]]));
      return xs.map((t) => map.get(t) ?? null);
    });

    // Convert timestamps from ms to Unix seconds
    return [xs.map((t) => t / 1000), ...ys];
  }

  onMount(() => {
    if (!containerRef) return;
    const topics = pinnedList();
    const opts = buildOpts(topics, containerRef);
    const data = buildData(topics);
    uplotInstance = new uPlot(opts, data, containerRef);

    // Resize observer
    const ro = new ResizeObserver(([entry]) => {
      if (!uplotInstance || !entry.contentRect.width) return;
      uplotInstance.setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
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
    <div class="flex flex-col h-full bg-slate-900 relative">
      {/* Config bar */}
      <div class="flex-shrink-0 px-3 py-2 border-b border-slate-700 bg-slate-800/40 flex items-center gap-2 overflow-x-auto min-h-0 relative z-10">
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
              const config = () => topicConfigs[topic] || { topic, pathConfig: { mode: "raw", path: "" } };
              return (
                <TopicConfigPill
                  topic={topic}
                  config={config().pathConfig}
                  onConfigChange={(newConfig) => {
                    setTopicConfigs(topic, { topic, pathConfig: newConfig });
                  }}
                  suggestedPaths={getSuggestedPaths(topic)}
                />
              );
            })}

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

      {/* Chart container */}
      <div class="flex-1 relative overflow-hidden bg-slate-850">
        <div
          ref={containerRef}
          class="w-full h-full"
          style={{ "background-color": "rgb(10, 15, 30)" }}
        />

        <Show when={!hasData()}>
          <div class="absolute inset-0 flex items-center justify-center text-slate-500 text-sm pointer-events-none">
            Waiting for data...
          </div>
        </Show>
      </div>
    </div>
  );
}
