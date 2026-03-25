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
