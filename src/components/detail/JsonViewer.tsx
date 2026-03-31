import { createSignal, For, Show } from "solid-js";
import { tooltip } from "../ui/tooltip";

interface Props {
  data: unknown;
  depth?: number;
  /** Current JSON path segments (built up during recursion) */
  path?: string[];
  /** Called when user clicks the chart icon on a numeric value. Receives the dot-path (e.g. "sensors.temperature"). */
  onChartPath?: (path: string) => void;
}

const GUTTER_W = 20; // px, width of the left gutter column

/** Wave icon pulled into the left gutter via negative margin */
function ChartGutter(props: { path: string; depth: number; onChartPath: (path: string) => void }) {
  // Pull the icon to the absolute left edge of the top-level wrapper
  // by using a negative margin equal to the current indentation + gutter width
  const offset = () => -(props.depth * 16 + GUTTER_W);
  return (
    <span
      class="absolute cursor-pointer text-slate-600 hover:text-blue-400 transition-colors select-none font-mono text-sm"
      style={{ left: `${offset()}px`, width: `${GUTTER_W}px`, "text-align": "center" }}
      use:tooltip={`Add "${props.path}" to chart`}
      onClick={(e) => { e.stopPropagation(); props.onChartPath(props.path); }}
    >∿</span>
  );
}

function isChartable(value: unknown): boolean {
  if (typeof value === "number" && isFinite(value)) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && isFinite(Number(trimmed));
  }
  return false;
}

export default function JsonViewer(props: Props) {
  const path = () => props.path ?? [];
  const hasGutter = () => !!props.onChartPath;

  // Top-level wrapper: add left padding for the gutter column
  return (
    <div class="relative" style={{ "padding-left": hasGutter() ? `${GUTTER_W}px` : "0" }}>
      <JsonViewerInner data={props.data} depth={0} path={path()} onChartPath={props.onChartPath} />
    </div>
  );
}

/** Inner viewer without the top-level wrapper */
function JsonViewerInner(props: Props) {
  const depth = () => props.depth ?? 0;
  const path = () => props.path ?? [];

  if (props.data === null) {
    return <span class="text-orange-400">null</span>;
  }

  if (props.data === undefined) {
    return <span class="text-slate-500">undefined</span>;
  }

  if (typeof props.data === "boolean") {
    return <span class="text-orange-400">{String(props.data)}</span>;
  }

  if (typeof props.data === "number") {
    return <span class="text-green-400">{String(props.data)}</span>;
  }

  if (typeof props.data === "string") {
    return <span class="text-amber-300">"{props.data}"</span>;
  }

  if (Array.isArray(props.data)) {
    return <CollapsibleArray data={props.data} depth={depth()} path={path()} onChartPath={props.onChartPath} />;
  }

  if (typeof props.data === "object") {
    return (
      <CollapsibleObject
        data={props.data as Record<string, unknown>}
        depth={depth()}
        path={path()}
        onChartPath={props.onChartPath}
      />
    );
  }

  return <span class="text-slate-300">{String(props.data)}</span>;
}

function CollapsibleObject(props: {
  data: Record<string, unknown>;
  depth: number;
  path: string[];
  onChartPath?: (path: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(props.depth < 3);
  const entries = () => Object.entries(props.data);

  return (
    <span class="font-mono text-sm">
      <span
        class="cursor-pointer text-slate-500 hover:text-slate-300"
        onClick={() => setExpanded(!expanded())}
      >
        {expanded() ? "▾" : "▸"}{" "}
      </span>
      <span class="text-slate-500">{"{"}</span>
      <Show
        when={expanded()}
        fallback={
          <span class="text-slate-500">
            {" "}
            {entries().length} keys{" "}
            {"}"}
          </span>
        }
      >
        <div style={{ "padding-left": "16px" }}>
          <For each={entries()}>
            {([key, value]) => {
              const childPath = [...props.path, key];
              const pathStr = childPath.join(".");
              const chartable = isChartable(value);
              return (
                <div class="relative">
                  <Show when={chartable && props.onChartPath}>
                    <ChartGutter path={pathStr} depth={props.depth + 1} onChartPath={props.onChartPath!} />
                  </Show>
                  <span class="text-blue-300">"{key}"</span>
                  <span class="text-slate-500">: </span>
                  <JsonViewerInner data={value} depth={props.depth + 1} path={childPath} onChartPath={props.onChartPath} />
                  <span class="text-slate-500">,</span>
                </div>
              );
            }}
          </For>
        </div>
        <span class="text-slate-500">{"}"}</span>
      </Show>
    </span>
  );
}

function CollapsibleArray(props: { data: unknown[]; depth: number; path: string[]; onChartPath?: (path: string) => void }) {
  const [expanded, setExpanded] = createSignal(props.depth < 3);

  return (
    <span class="font-mono text-sm">
      <span
        class="cursor-pointer text-slate-500 hover:text-slate-300"
        onClick={() => setExpanded(!expanded())}
      >
        {expanded() ? "▾" : "▸"}{" "}
      </span>
      <span class="text-slate-500">[</span>
      <Show
        when={expanded()}
        fallback={
          <span class="text-slate-500">
            {" "}
            {props.data.length} items{" "}
            ]
          </span>
        }
      >
        <div style={{ "padding-left": "16px" }}>
          <For each={props.data}>
            {(item, index) => {
              const childPath = [...props.path, String(index())];
              const pathStr = childPath.join(".");
              const chartable = isChartable(item);
              return (
                <div class="relative">
                  <Show when={chartable && props.onChartPath}>
                    <ChartGutter path={pathStr} depth={props.depth + 1} onChartPath={props.onChartPath!} />
                  </Show>
                  <span class="text-slate-600 text-xs mr-1">{index()}</span>
                  <JsonViewerInner data={item} depth={props.depth + 1} path={childPath} onChartPath={props.onChartPath} />
                  <span class="text-slate-500">,</span>
                </div>
              );
            }}
          </For>
        </div>
        <span class="text-slate-500">]</span>
      </Show>
    </span>
  );
}
