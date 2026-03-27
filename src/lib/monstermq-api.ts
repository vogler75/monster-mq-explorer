export interface MonsterMqArchiveGroup {
  name: string;
}

export interface MonsterMqArchivedMessage {
  topic: string;
  payload: string;
  timestamp: number;
  qos: number;
}

async function graphqlPost(url: string, body: object): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export async function fetchArchiveGroups(graphqlUrl: string): Promise<MonsterMqArchiveGroup[]> {
  const data = await graphqlPost(graphqlUrl, {
    query: `{ archiveGroups(enabled: true) { name } }`,
  });
  return data.archiveGroups ?? [];
}

export async function fetchArchivedMessages(
  graphqlUrl: string,
  opts: {
    topicFilter: string;
    startTime: string;
    endTime: string;
    archiveGroup: string;
    limit?: number;
  },
): Promise<MonsterMqArchivedMessage[]> {
  const data = await graphqlPost(graphqlUrl, {
    query: `query ArchivedMessages($topicFilter: String!, $startTime: String, $endTime: String, $archiveGroup: String!, $limit: Int) {
      archivedMessages(topicFilter: $topicFilter, startTime: $startTime, endTime: $endTime, archiveGroup: $archiveGroup, limit: $limit, format: JSON) {
        topic
        payload
        timestamp
        qos
      }
    }`,
    variables: {
      topicFilter: opts.topicFilter,
      startTime: opts.startTime,
      endTime: opts.endTime,
      archiveGroup: opts.archiveGroup,
      limit: opts.limit ?? 1000,
    },
  });
  return data.archivedMessages ?? [];
}
