import { createSignal, createMemo, For, Show } from "solid-js";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { useTabPinnedTopics } from "../../stores/tabStore";
import { fetchArchivedMessages, type MonsterMqArchivedMessage } from "../../lib/monstermq-api";

function toLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

interface HistoryConnection {
  connectionId: string;
  connectionName: string;
  graphqlUrl: string;
  archiveGroups: string[];
  topics: string[]; // cleaned (prefix stripped)
}

export default function HistoryPane() {
  const { getArchiveGroups } = useUI();
  const { connections } = useConnections();
  const { pinnedTopics } = useTabPinnedTopics();

  // All MonsterMQ connections that have pinned topics, with their available archive groups
  const historyConnections = createMemo((): HistoryConnection[] => {
    const pinned = [...pinnedTopics()];
    if (pinned.length === 0) return [];

    const result: HistoryConnection[] = [];
    for (const conn of connections) {
      if (!conn.isMonsterMq || !conn.monsterMqGraphqlUrl) continue;
      const prefix = conn.name + "/";
      const matching = pinned.filter((t) => t.startsWith(prefix));
      if (matching.length > 0) {
        result.push({
          connectionId: conn.id,
          connectionName: conn.name,
          graphqlUrl: conn.monsterMqGraphqlUrl,
          archiveGroups: getArchiveGroups(conn.id),
          topics: matching.map((t) => t.slice(prefix.length)),
        });
      }
    }
    return result;
  });

  const queryableTopicCount = createMemo(() =>
    historyConnections().reduce((sum, c) => sum + c.topics.length, 0)
  );

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Per-connection archive group selection: Map<connectionId, archiveGroup>
  const [selectedGroups, setSelectedGroups] = createSignal<Map<string, string>>(new Map());
  const [fromTime, setFromTime] = createSignal(toLocalDatetime(oneHourAgo));
  const [toTime, setToTime] = createSignal(toLocalDatetime(now));
  const [limit, setLimit] = createSignal(1000);
  const [results, setResults] = createSignal<MonsterMqArchivedMessage[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function getSelectedGroup(connId: string, fallbackGroups: string[]): string {
    return selectedGroups().get(connId) ?? fallbackGroups[0] ?? "Default";
  }

  function setSelectedGroup(connId: string, group: string) {
    setSelectedGroups((prev) => new Map(prev).set(connId, group));
  }

  async function runQuery() {
    const conns = historyConnections();
    if (conns.length === 0) {
      setError("No pinned topics from any MonsterMQ connection.");
      return;
    }

    const startTime = new Date(fromTime()).toISOString();
    const endTime = new Date(toTime()).toISOString();

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const allMessages: MonsterMqArchivedMessage[] = [];
      await Promise.all(
        conns.flatMap((conn) => {
          const group = getSelectedGroup(conn.connectionId, conn.archiveGroups);
          return conn.topics.map(async (topic) => {
            const msgs = await fetchArchivedMessages(conn.graphqlUrl, {
              topicFilter: topic,
              startTime,
              endTime,
              archiveGroup: group,
              limit: limit(),
            });
            allMessages.push(...msgs);
          });
        }),
      );

      allMessages.sort((a, b) => a.timestamp - b.timestamp);
      setResults(allMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    const rows = results();
    if (rows.length === 0) return;
    const escape = (s: string) => {
      if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = ["timestamp,topic,qos,payload"];
    for (const msg of rows) {
      lines.push(`${new Date(msg.timestamp).toISOString()},${escape(msg.topic)},${msg.qos},${escape(msg.payload)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `history-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Resizable column widths
  const [colTimestamp, setColTimestamp] = createSignal(180);
  const [colTopic, setColTopic] = createSignal(200);

  function startColResize(setter: (v: number) => void, e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const th = (e.target as HTMLElement).parentElement!;
    const startW = th.getBoundingClientRect().width;
    function onMove(e: MouseEvent) {
      setter(Math.max(60, startW + e.clientX - startX));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const inputClass = "px-2 py-1 text-xs bg-slate-800 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500";

  return (
    <div class="h-full flex flex-col">
      {/* Toolbar */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0 flex-wrap">
        <label class="text-xs text-slate-400 ml-2">From</label>
        <input
          type="datetime-local"
          class={inputClass}
          value={fromTime()}
          onInput={(e) => setFromTime(e.currentTarget.value)}
        />

        <label class="text-xs text-slate-400 ml-2">To</label>
        <input
          type="datetime-local"
          class={inputClass}
          value={toTime()}
          onInput={(e) => setToTime(e.currentTarget.value)}
        />

        <label class="text-xs text-slate-400 ml-2">Limit</label>
        <input
          type="number"
          class={inputClass + " w-20"}
          value={limit()}
          min={1}
          onInput={(e) => setLimit(parseInt(e.currentTarget.value) || 1000)}
        />

        <button
          class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-2"
          onClick={runQuery}
          disabled={loading() || queryableTopicCount() === 0}
        >
          {loading() ? "Querying..." : "Query"}
        </button>

        <button
          class="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={exportCsv}
          disabled={results().length === 0}
          title="Export as CSV"
        >
          Export CSV
        </button>

        <Show when={queryableTopicCount() === 0}>
          <span class="text-xs text-slate-500 ml-2">Pin topics from a MonsterMQ connection to query history</span>
        </Show>
      </div>

      {/* Per-connection archive group selectors */}
      <Show when={historyConnections().length > 0}>
        <div class="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700 shrink-0 flex-wrap">
          <For each={historyConnections()}>
            {(conn) => (
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-slate-400 font-medium">{conn.connectionName}</span>
                <select
                  class={inputClass + " w-32"}
                  value={getSelectedGroup(conn.connectionId, conn.archiveGroups)}
                  onChange={(e) => setSelectedGroup(conn.connectionId, e.currentTarget.value)}
                >
                  <For each={conn.archiveGroups}>
                    {(group) => <option value={group}>{group}</option>}
                  </For>
                </select>
                <span class="text-xs text-slate-500">({conn.topics.length} topic{conn.topics.length !== 1 ? "s" : ""})</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Error */}
      <Show when={error()}>
        <div class="px-3 py-2 text-xs text-red-400 bg-red-900/20 border-b border-red-800/30">
          {error()}
        </div>
      </Show>

      {/* Results table */}
      <div class="flex-1 overflow-auto">
        <Show
          when={results().length > 0}
          fallback={
            <Show when={!loading() && !error()}>
              <div class="text-slate-500 text-sm p-4">
                {queryableTopicCount() > 0
                  ? "Click Query to load historical data for pinned topics."
                  : "Pin topics from a MonsterMQ connection, then query their history here."}
              </div>
            </Show>
          }
        >
          <table class="w-full text-xs" style={{ "table-layout": "fixed" }}>
            <colgroup>
              <col style={{ width: `${colTimestamp()}px` }} />
              <col style={{ width: `${colTopic()}px` }} />
              <col />
            </colgroup>
            <thead class="sticky top-0 bg-slate-800 z-10">
              <tr class="border-b border-slate-700">
                <th class="text-left px-3 py-1.5 text-slate-400 font-medium relative">
                  Timestamp
                  <div class="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50" onMouseDown={[startColResize, setColTimestamp]} />
                </th>
                <th class="text-left px-3 py-1.5 text-slate-400 font-medium relative">
                  Topic
                  <div class="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50" onMouseDown={[startColResize, setColTopic]} />
                </th>
                <th class="text-left px-3 py-1.5 text-slate-400 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              <For each={results()}>
                {(msg) => (
                  <tr class="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td class="px-3 py-1 text-slate-400 font-mono whitespace-nowrap overflow-hidden text-ellipsis">{formatTs(msg.timestamp)}</td>
                    <td class="px-3 py-1 text-slate-300 font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={msg.topic}>{msg.topic}</td>
                    <td class="px-3 py-1 text-slate-300 font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={msg.payload}>{msg.payload}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <div class="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-700">
            {results().length} message{results().length !== 1 ? "s" : ""}
          </div>
        </Show>
      </div>
    </div>
  );
}
