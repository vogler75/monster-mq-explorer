import { createSignal, For, Show } from "solid-js";

interface Props {
  data: unknown;
  depth?: number;
}

export default function JsonViewer(props: Props) {
  const depth = () => props.depth ?? 0;

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
    return <CollapsibleArray data={props.data} depth={depth()} />;
  }

  if (typeof props.data === "object") {
    return (
      <CollapsibleObject
        data={props.data as Record<string, unknown>}
        depth={depth()}
      />
    );
  }

  return <span class="text-slate-300">{String(props.data)}</span>;
}

function CollapsibleObject(props: {
  data: Record<string, unknown>;
  depth: number;
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
            {([key, value]) => (
              <div>
                <span class="text-blue-300">"{key}"</span>
                <span class="text-slate-500">: </span>
                <JsonViewer data={value} depth={props.depth + 1} />
                <span class="text-slate-500">,</span>
              </div>
            )}
          </For>
        </div>
        <span class="text-slate-500">{"}"}</span>
      </Show>
    </span>
  );
}

function CollapsibleArray(props: { data: unknown[]; depth: number }) {
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
            {(item, index) => (
              <div>
                <span class="text-slate-600 text-xs mr-1">{index()}</span>
                <JsonViewer data={item} depth={props.depth + 1} />
                <span class="text-slate-500">,</span>
              </div>
            )}
          </For>
        </div>
        <span class="text-slate-500">]</span>
      </Show>
    </span>
  );
}
