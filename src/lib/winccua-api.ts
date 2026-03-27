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

export async function browseLoggingTags(config: BrowseConfig, tagName: string, token?: string): Promise<string[]> {
  const url = httpUrl(config);
  const result = await graphqlPost(url, {
    query: `query Browse($nameFilters: [String], $objectTypeFilters: [ObjectTypesEnum]) { browse(nameFilters: $nameFilters, objectTypeFilters: $objectTypeFilters) { name } }`,
    variables: { nameFilters: [`${tagName}:*`], objectTypeFilters: ["LOGGINGTAG"] },
  }, token) as { data?: { browse?: { name: string }[] }; errors?: unknown[] };
  if (result.errors) throw new Error(`Browse failed: ${JSON.stringify(result.errors)}`);
  return result.data?.browse?.map((r) => r.name) ?? [];
}

export interface WinccUaLoggedValue {
  loggingTagName: string;
  timestamp: string;
  value: unknown;
  quality: string | null;
}

export async function queryLoggedTagValues(
  config: BrowseConfig,
  names: string[],
  startTime: string,
  endTime: string,
  maxNumberOfValues: number,
  token?: string,
): Promise<WinccUaLoggedValue[]> {
  const url = httpUrl(config);
  const result = await graphqlPost(url, {
    query: `query LoggedTagValues($names: [String]!, $startTime: Timestamp!, $endTime: Timestamp!, $maxNumberOfValues: Int!) {
      loggedTagValues(names: $names, startTime: $startTime, endTime: $endTime, maxNumberOfValues: $maxNumberOfValues) {
        loggingTagName
        error { code description }
        values {
          value { value timestamp quality { quality } }
        }
      }
    }`,
    variables: { names, startTime, endTime, maxNumberOfValues },
  }, token) as { data?: { loggedTagValues?: any[] }; errors?: unknown[] };
  if (result.errors) throw new Error(`Query failed: ${JSON.stringify(result.errors)}`);

  const rows: WinccUaLoggedValue[] = [];
  for (const entry of result.data?.loggedTagValues ?? []) {
    if (entry.error?.code && entry.error.code !== "0") continue;
    for (const v of entry.values ?? []) {
      rows.push({
        loggingTagName: entry.loggingTagName ?? "",
        timestamp: v.value?.timestamp ?? "",
        value: v.value?.value ?? null,
        quality: v.value?.quality?.quality ?? null,
      });
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

  const result = await graphqlPost(url, {
    query: `query Browse($nameFilters: [String], $objectTypeFilters: [ObjectTypesEnum]) { browse(nameFilters: $nameFilters, objectTypeFilters: $objectTypeFilters) { name } }`,
    variables: { nameFilters, objectTypeFilters: ["TAG"] },
  }, token) as { data?: { browse?: { name: string }[] }; errors?: unknown[] };

  if (result.errors) throw new Error(`Browse failed: ${JSON.stringify(result.errors)}`);
  return result.data?.browse?.map((r) => r.name) ?? [];
}
