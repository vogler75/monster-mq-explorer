import { createSignal, createMemo, createEffect, on, For, Show } from "solid-js";
import { useUI } from "../../stores/ui";
import { useConnections } from "../../stores/connections";
import { useTabPinnedTopics } from "../../stores/tabStore";
import { fetchArchivedMessages } from "../../lib/monstermq-api";
import { browseLoggingTags, queryLoggedTagValues, type BrowseConfig } from "../../lib/winccua-api";

function toLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTs(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

/** Unified result row for both MonsterMQ and WinCC UA */
interface HistoryRow {
  timestamp: number;
  topic: string;
  payload: string;
}


interface MonsterMqGroup {
  type: "monstermq";
  connectionId: string;
  connectionName: string;
  graphqlUrl: string;
  archiveGroups: string[];
  topics: string[]; // cleaned (prefix stripped)
}

interface WinccUaGroup {
  type: "winccua";
  connectionId: string;
  connectionName: string;
  browseConfig: BrowseConfig;
  tagPathSplit: string;
  topics: string[]; // cleaned (prefix stripped) — these are topic paths, need conversion to tag names
}

type HistoryGroup = MonsterMqGroup | WinccUaGroup;

export default function HistoryPane() {
  const { getArchiveGroups, getLoggingTags, setLoggingTags, getWinccToken, getOriginalTagName } = useUI();
  const { connections } = useConnections();
  const { pinnedTopics } = useTabPinnedTopics();

  // All connections that support history queries and have pinned topics
  const historyGroups = createMemo((): HistoryGroup[] => {
    const pinned = [...pinnedTopics()];
    if (pinned.length === 0) return [];

    const claimed = new Set<string>(); // topics already assigned to a connection
    const result: HistoryGroup[] = [];
    for (const conn of connections) {
      // MQTT connections prefix topics with "connectionName/"
      // WinCC UA/OA connections use topics as-is (no prefix)
      const isMqtt = conn.connectionType === "mqtt";
      const prefix = isMqtt ? conn.name + "/" : "";

      let matching: string[];
      if (isMqtt) {
        matching = pinned.filter((t) => t.startsWith(prefix) && !claimed.has(t));
      } else {
        // For WinCC, all unclaimed topics are candidates
        matching = pinned.filter((t) => !claimed.has(t));
      }
      if (matching.length === 0) continue;

      const topics = isMqtt ? matching.map((t) => t.slice(prefix.length)) : matching;

      if (conn.isMonsterMq && conn.monsterMqGraphqlUrl) {
        for (const t of matching) claimed.add(t);
        result.push({
          type: "monstermq",
          connectionId: conn.id,
          connectionName: conn.name,
          graphqlUrl: conn.monsterMqGraphqlUrl,
          archiveGroups: getArchiveGroups(conn.id),
          topics,
        });
      } else if (conn.connectionType === "winccua") {
        for (const t of matching) claimed.add(t);
        result.push({
          type: "winccua",
          connectionId: conn.id,
          connectionName: conn.name,
          browseConfig: {
            host: conn.host,
            port: conn.port,
            protocol: conn.protocol,
            path: conn.path,
            username: conn.username,
            password: conn.password,
          },
          tagPathSplit: conn.tagPathSplit,
          topics,
        });
      }
    }
    return result;
  });

  const queryableTopicCount = createMemo(() =>
    historyGroups().reduce((sum, g) => sum + g.topics.length, 0)
  );

  // Auto-browse logging tags for WinCC UA topics when they appear
  createEffect(on(historyGroups, (groups) => {
    for (const g of groups) {
      if (g.type !== "winccua") continue;
      const token = getWinccToken(g.connectionId);
      for (const topic of g.topics) {
        const tagName = getOriginalTagName(g.connectionId, topic) ?? topic;
        // Only browse if we don't already have logging tags cached
        if (getLoggingTags(g.connectionId, topic).length > 0) continue;
        console.log(`[WinCC UA] Browsing logging tags: topic="${topic}" tagName="${tagName}" nameFilter="${tagName}:*"`);
        browseLoggingTags(g.browseConfig, tagName, token)
          .then((tags) => {
            console.log(`[WinCC UA] Logging tags for ${tagName}:`, tags);
            setLoggingTags(g.connectionId, topic, tags);
          })
          .catch((err) => console.error(`[WinCC UA] Failed to browse logging tags for ${tagName}:`, err));
      }
    }
  }));

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Per-connection archive group selection (MonsterMQ): Map<connectionId, archiveGroup>
  const [selectedGroups, setSelectedGroups] = createSignal<Map<string, string>>(new Map());
  // Per-topic logging tag selection (WinCC UA): Map<"connectionId:tagName", loggingTagName>
  const [selectedLoggingTags, setSelectedLoggingTags] = createSignal<Map<string, string>>(new Map());
  const [fromTime, setFromTime] = createSignal(toLocalDatetime(oneHourAgo));
  const [toTime, setToTime] = createSignal(toLocalDatetime(now));
  const [limit, setLimit] = createSignal(1000);
  const [results, setResults] = createSignal<HistoryRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function getSelectedGroup(connId: string, fallbackGroups: string[]): string {
    return selectedGroups().get(connId) ?? fallbackGroups[0] ?? "Default";
  }

  function setSelectedGroup(connId: string, group: string) {
    setSelectedGroups((prev) => new Map(prev).set(connId, group));
  }

  function getSelectedLoggingTag(connId: string, tagName: string): string {
    const key = `${connId}:${tagName}`;
    const selected = selectedLoggingTags().get(key);
    if (selected) return selected;
    // Default to first available logging tag
    const available = getLoggingTags(connId, tagName);
    return available[0] ?? "";
  }

  function setSelectedLoggingTag(connId: string, tagName: string, loggingTag: string) {
    setSelectedLoggingTags((prev) => new Map(prev).set(`${connId}:${tagName}`, loggingTag));
  }

  async function runQuery() {
    const groups = historyGroups();
    if (groups.length === 0) {
      setError("No pinned topics from any connection with history support.");
      return;
    }

    const startTime = new Date(fromTime()).toISOString();
    const endTime = new Date(toTime()).toISOString();

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const allRows: HistoryRow[] = [];

      await Promise.all(
        groups.map(async (g) => {
          if (g.type === "monstermq") {
            const group = getSelectedGroup(g.connectionId, g.archiveGroups);
            await Promise.all(
              g.topics.map(async (topic) => {
                const msgs = await fetchArchivedMessages(g.graphqlUrl, {
                  topicFilter: topic,
                  startTime,
                  endTime,
                  archiveGroup: group,
                  limit: limit(),
                });
                for (const m of msgs) {
                  allRows.push({ timestamp: m.timestamp, topic: m.topic, payload: m.payload });
                }
              }),
            );
          } else if (g.type === "winccua") {
            // Collect selected logging tag names for all topics
            const loggingNames: string[] = [];
            const nameToTopic = new Map<string, string>();
            for (const topic of g.topics) {
              const tagName = topic;
              const loggingTag = getSelectedLoggingTag(g.connectionId, tagName);
              if (loggingTag) {
                loggingNames.push(loggingTag);
                nameToTopic.set(loggingTag, topic);
              }
            }
            if (loggingNames.length === 0) return;

            const token = getWinccToken(g.connectionId);
            const values = await queryLoggedTagValues(
              g.browseConfig,
              loggingNames,
              startTime,
              endTime,
              limit(),
              token,
            );
            for (const v of values) {
              allRows.push({
                timestamp: new Date(v.timestamp).getTime(),
                topic: nameToTopic.get(v.loggingTagName) ?? v.loggingTagName,
                payload: typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value ?? ""),
              });
            }
          }
        }),
      );

      allRows.sort((a, b) => a.timestamp - b.timestamp);
      setResults(allRows);
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
    const lines = ["timestamp,topic,payload"];
    for (const row of rows) {
      lines.push(`${new Date(row.timestamp).toISOString()},${escape(row.topic)},${escape(row.payload)}`);
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
          <span class="text-xs text-slate-500 ml-2">Pin topics from a connection with history support</span>
        </Show>
      </div>

      {/* Per-connection / per-topic archive selectors */}
      <Show when={historyGroups().length > 0}>
        <div class="px-3 py-1.5 border-b border-slate-700 shrink-0 space-y-1.5 max-h-40 overflow-auto">
          <For each={historyGroups()}>
            {(group) => (
              <Show when={group.type === "monstermq"} fallback={
                /* WinCC UA: per-topic logging tag selector */
                <div>
                  <div class="text-xs text-slate-400 font-medium mb-1">{group.connectionName} <span class="text-slate-500 font-normal">(WinCC Unified)</span></div>
                  <div class="space-y-0.5 ml-2">
                    <For each={group.topics}>
                      {(topic) => {
                        const tagName = () => topic;
                        const loggingTags = () => getLoggingTags(group.connectionId, tagName());
                        return (
                          <div class="flex items-center gap-1.5 text-xs">
                            <span class="text-slate-400 font-mono truncate max-w-[200px]" title={tagName()}>{topic}</span>
                            <Show when={loggingTags().length > 0} fallback={
                              <span class="text-slate-500 italic">no logging tags</span>
                            }>
                              <select
                                class={inputClass + " w-44"}
                                value={getSelectedLoggingTag(group.connectionId, tagName())}
                                onChange={(e) => setSelectedLoggingTag(group.connectionId, tagName(), e.currentTarget.value)}
                              >
                                <For each={loggingTags()}>
                                  {(lt) => <option value={lt}>{lt.split(":").pop()}</option>}
                                </For>
                              </select>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              }>
                {/* MonsterMQ: per-connection archive group */}
                <div class="flex items-center gap-1.5">
                  <span class="text-xs text-slate-400 font-medium">{group.connectionName}</span>
                  <select
                    class={inputClass + " w-32"}
                    value={getSelectedGroup(group.connectionId, (group as MonsterMqGroup).archiveGroups)}
                    onChange={(e) => setSelectedGroup(group.connectionId, e.currentTarget.value)}
                  >
                    <For each={(group as MonsterMqGroup).archiveGroups}>
                      {(ag) => <option value={ag}>{ag}</option>}
                    </For>
                  </select>
                  <span class="text-xs text-slate-500">({group.topics.length} topic{group.topics.length !== 1 ? "s" : ""})</span>
                </div>
              </Show>
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
                  : "Pin topics from a connection with history support, then query here."}
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
                <th class="text-left px-3 py-1.5 text-slate-400 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              <For each={results()}>
                {(row) => (
                  <tr class="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td class="px-3 py-1 text-slate-400 font-mono whitespace-nowrap overflow-hidden text-ellipsis">{formatTs(row.timestamp)}</td>
                    <td class="px-3 py-1 text-slate-300 font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={row.topic}>{row.topic}</td>
                    <td class="px-3 py-1 text-slate-300 font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={row.payload}>{row.payload}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <div class="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-700">
            {results().length} row{results().length !== 1 ? "s" : ""}
          </div>
        </Show>
      </div>
    </div>
  );
}
