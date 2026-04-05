declare const __ELECTRON__: boolean | undefined;

export interface BrowseConfig {
  host: string;
  port: number;
  protocol: "ws" | "wss";
  path: string;
  username: string;
  password: string;
  ignoreCertErrors?: boolean;
}

async function graphqlPost(url: string, body: object, token?: string, ignoreCertErrors?: boolean): Promise<unknown> {
  // Electron: route through main process (Node.js) to bypass Chromium HSTS and cert issues
  if (typeof __ELECTRON__ !== "undefined" && __ELECTRON__ && window.mqttIpc?.graphqlProxy) {
    return window.mqttIpc.graphqlProxy({ url, body, token, ignoreCertErrors });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  headers["X-Wincc-Target"] = url;
  if (ignoreCertErrors) headers["X-Ignore-Cert-Errors"] = "1";
  const fetchUrl = "/api/winccua-proxy";

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
  }, undefined, config.ignoreCertErrors) as { data?: { login?: { token?: string } }; errors?: unknown[] };
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
  }, token, config.ignoreCertErrors) as { data?: { browse?: { name: string }[] }; errors?: unknown[] };
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
  }, token, config.ignoreCertErrors) as { data?: { loggedTagValues?: any[] }; errors?: unknown[] };
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

export async function browseTags(config: BrowseConfig, nameFilters: string[], token?: string): Promise<string[]> {
  const url = httpUrl(config);
  const result = await graphqlPost(url, {
    query: `query Browse($nameFilters: [String], $objectTypeFilters: [ObjectTypesEnum]) { browse(nameFilters: $nameFilters, objectTypeFilters: $objectTypeFilters) { name } }`,
    variables: { nameFilters, objectTypeFilters: ["TAG"] },
  }, token, config.ignoreCertErrors) as { data?: { browse?: { name: string }[] }; errors?: unknown[] };
  if (result.errors) throw new Error(`Browse failed: ${JSON.stringify(result.errors)}`);
  return result.data?.browse?.map((r) => r.name) ?? [];
}

export async function loginAndBrowse(config: BrowseConfig, nameFilters: string[]): Promise<string[]> {
  const token = await login(config);
  return browseTags(config, nameFilters, token);
}
