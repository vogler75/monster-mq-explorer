declare const __ELECTRON__: boolean | undefined;

export interface BrowseConfig {
  host: string;
  port: number;
  protocol: "ws" | "wss";
  path: string;
  username: string;
  password: string;
}

async function graphqlPost(url: string, body: object, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let fetchUrl = url;
  if (typeof __ELECTRON__ === "undefined" || !__ELECTRON__) {
    headers["X-Wincc-Target"] = url;
    fetchUrl = "/api/winccua-proxy";
  }

  const res = await fetch(fetchUrl, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

function httpUrl(config: BrowseConfig): string {
  const scheme = config.protocol === "wss" ? "https" : "http";
  return `${scheme}://${config.host}:${config.port}${config.path}`;
}

export async function login(config: BrowseConfig): Promise<string | undefined> {
  if (!config.username) return undefined;
  const url = httpUrl(config);
  const result = await graphqlPost(url, {
    query: `mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { token } }`,
    variables: { username: config.username, password: config.password },
  }) as { data?: { login?: { token?: string } }; errors?: unknown[] };
  if (result.errors) throw new Error(`Login failed: ${JSON.stringify(result.errors)}`);
  const token = result.data?.login?.token;
  if (!token) throw new Error("Login succeeded but returned no token");
  return token;
}

export interface WinccOaHistoryValue {
  dpeName: string;
  timestamp: string;
  value: unknown;
}

/**
 * Query historical data via dpGetPeriod.
 * For each dpeName, queries :_offline.._value and :_offline.._status.
 * Timestamps come from the value result (shared with status).
 */
export async function queryDpGetPeriod(
  config: BrowseConfig,
  dpeNames: string[],
  startTime: string,
  endTime: string,
  token?: string,
): Promise<WinccOaHistoryValue[]> {
  const url = httpUrl(config);

  const queryDpes = dpeNames.map((name) => `${name}:_offline.._value`);

  const result = await graphqlPost(url, {
    query: `query GetPeriod($startTime: Time!, $endTime: Time!, $dpeNames: [String!]!) {
      api { dp { getPeriod(startTime: $startTime, endTime: $endTime, dpeNames: $dpeNames) } }
    }`,
    variables: { startTime, endTime, dpeNames: queryDpes },
  }, token) as { data?: { api?: { dp?: { getPeriod?: unknown } } }; errors?: unknown[] };
  console.log("[WinCC OA] getPeriod request:", { dpeNames: queryDpes, startTime, endTime });
  console.log("[WinCC OA] getPeriod response:", JSON.stringify(result, null, 2));
  if (result.errors) throw new Error(`Query failed: ${JSON.stringify(result.errors)}`);

  // getPeriod returns an array of results per DPE, each with timestamps[] and values[]
  // One result per DPE, each with times[] and values[]
  const raw = result.data?.api?.dp?.getPeriod;
  const rows: WinccOaHistoryValue[] = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < dpeNames.length; i++) {
      const entry = raw[i] as { times?: string[]; values?: unknown[] } | undefined;
      const dpeName = dpeNames[i];
      const timestamps = entry?.times ?? [];
      const values = entry?.values ?? [];
      for (let j = 0; j < timestamps.length; j++) {
        rows.push({
          dpeName,
          timestamp: timestamps[j],
          value: values[j] ?? null,
        });
      }
    }
  }
  return rows;
}

export async function loginAndBrowse(config: BrowseConfig, nameFilters: string[]): Promise<string[]> {
  const url = httpUrl(config);

  let token: string | undefined;
  if (config.username) {
    const result = await graphqlPost(url, {
      query: `mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { token } }`,
      variables: { username: config.username, password: config.password },
    }) as { data?: { login?: { token?: string } }; errors?: unknown[] };
    if (result.errors) throw new Error(`Login failed: ${JSON.stringify(result.errors)}`);
    token = result.data?.login?.token;
    if (!token) throw new Error("Login succeeded but returned no token");
  }

  const allNames = new Set<string>();
  for (const pattern of nameFilters) {
    const result = await graphqlPost(url, {
      query: `query Names($pattern: String) { api { dp { names(dpPattern: $pattern) } } }`,
      variables: { pattern },
    }, token) as { data?: { api?: { dp?: { names?: string[] } } }; errors?: unknown[] };

    if (result.errors) throw new Error(`Browse failed: ${JSON.stringify(result.errors)}`);
    const names = result.data?.api?.dp?.names ?? [];
    for (const n of names) allNames.add(n);
  }

  return Array.from(allNames);
}
