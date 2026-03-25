import { createSignal, For, Show } from "solid-js";
import { loginAndBrowse, type BrowseConfig } from "../../lib/winccua-api";

interface Props {
  config: BrowseConfig;
  onAdd: (tags: string[]) => void;
  onClose: () => void;
  browseFn?: (config: BrowseConfig, filters: string[]) => Promise<string[]>;
}

export default function TagBrowserModal(props: Props) {
  const [filter, setFilter] = createSignal("*");
  const [tags, setTags] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let lastClickedIndex = -1;

  async function browse() {
    setLoading(true);
    setError(null);
    try {
      const browse = props.browseFn ?? loginAndBrowse;
      const result = await browse(props.config, [filter()]);
      setTags(result);
      setSelected(new Set());
      lastClickedIndex = -1;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleTagClick(e: MouseEvent, index: number) {
    const list = tags();
    if (e.shiftKey && lastClickedIndex !== -1) {
      const from = Math.min(lastClickedIndex, index);
      const to = Math.max(lastClickedIndex, index);
      const adding = !selected().has(list[lastClickedIndex]);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          if (adding) next.add(list[i]); else next.delete(list[i]);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(list[index])) next.delete(list[index]); else next.add(list[index]);
        return next;
      });
      lastClickedIndex = index;
    }
  }

  const inputBase = "px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500";

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div class="bg-slate-800 border border-slate-700 rounded-lg w-[800px] max-h-[80vh] flex flex-col shadow-xl">
        <div class="px-4 py-3 border-b border-slate-700">
          <h2 class="text-sm font-semibold text-slate-200">Browse Tags</h2>
        </div>

        <div class="px-4 py-3 border-b border-slate-700 flex gap-2">
          <input
            class={inputBase + " flex-1"}
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && browse()}
            placeholder="Name filter, e.g. System1::* or *"
          />
          <button
            class="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
            onClick={browse}
            disabled={loading()}
          >
            {loading() ? "Browsing…" : "Browse"}
          </button>
        </div>

        <Show when={error()}>
          <div class="px-4 py-2 text-xs text-red-400">{error()}</div>
        </Show>

        <div class="flex-1 overflow-y-auto min-h-0">
          <Show when={tags().length > 0}>
            <div class="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
              <span class="text-xs text-slate-400">{tags().length} tags — {selected().size} selected</span>
              <div class="flex gap-3">
                <button class="text-xs text-blue-400 hover:text-blue-300" onClick={() => setSelected(new Set(tags()))}>All</button>
                <button class="text-xs text-slate-400 hover:text-slate-300" onClick={() => setSelected(new Set())}>None</button>
              </div>
            </div>
            <div class="divide-y divide-slate-700/40">
              <For each={tags()}>
                {(tag, i) => (
                  <label
                    class="flex items-center gap-2.5 px-4 py-1.5 hover:bg-slate-700/50 cursor-pointer select-none"
                    onClick={(e) => { e.preventDefault(); handleTagClick(e, i()); }}
                  >
                    <input
                      type="checkbox"
                      class="accent-blue-500 shrink-0 pointer-events-none"
                      checked={selected().has(tag)}
                      readOnly
                    />
                    <span class="text-xs text-slate-300 font-mono">{tag}</span>
                  </label>
                )}
              </For>
            </div>
          </Show>
          <Show when={tags().length === 0 && !loading() && !error()}>
            <div class="px-4 py-10 text-xs text-slate-500 text-center">
              Enter a filter and click Browse to find tags.
            </div>
          </Show>
        </div>

        <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-700">
          <button
            class="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
            onClick={() => props.onAdd([...selected()])}
            disabled={selected().size === 0}
          >
            Add {selected().size > 0 ? selected().size : ""} selected
          </button>
        </div>
      </div>
    </div>
  );
}
