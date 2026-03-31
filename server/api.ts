import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const DATA_DIR = path.resolve(process.cwd(), "data");
const CONNECTIONS_FILE = path.join(DATA_DIR, "connections.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readConnections(): unknown[] {
  ensureDataDir();
  if (!fs.existsSync(CONNECTIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeConnections(data: unknown[]) {
  ensureDataDir();
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(data, null, 2));
}

function proxyFetch(target: string, headers: Record<string, string>, body: string, ignoreCert: boolean): Promise<{ status: number; text: string }> {
  if (!ignoreCert) {
    return fetch(target, { method: "POST", headers, body })
      .then(async (r) => ({ status: r.status, text: await r.text() }));
  }
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const isHttps = u.protocol === "https:";
    const bodyBuf = Buffer.from(body);
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? "443" : "80"),
      path: u.pathname + (u.search || ""),
      method: "POST" as const,
      headers: { ...headers, "Content-Length": String(bodyBuf.length) },
      rejectUnauthorized: false,
    };
    (isHttps ? https : http).request(options, (r) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode ?? 200, text: Buffer.concat(chunks).toString() }));
    }).on("error", reject).end(bodyBuf);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url ?? "";

  if (!url.startsWith("/api/")) return false;

  res.setHeader("Content-Type", "application/json");

  // GET /api/connections
  if (url === "/api/connections" && req.method === "GET") {
    res.end(JSON.stringify(readConnections()));
    return true;
  }

  // PUT /api/connections — replace all connections
  if (url === "/api/connections" && req.method === "PUT") {
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      if (!Array.isArray(data)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Expected array" }));
        return true;
      }
      writeConnections(data);
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
    return true;
  }

  // POST /api/winccua-proxy — forward GraphQL HTTP requests to WinCC UA server,
  // bypassing CORS restrictions that the browser enforces for cross-origin fetches.
  if (url === "/api/winccua-proxy" && req.method === "POST") {
    const target = req.headers["x-wincc-target"] as string | undefined;
    if (!target) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing X-Wincc-Target header" }));
      return true;
    }
    const body = await readBody(req);
    const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const auth = req.headers["authorization"];
    if (auth) forwardHeaders["Authorization"] = typeof auth === "string" ? auth : auth[0];
    const ignoreCert = req.headers["x-ignore-cert-errors"] === "1";
    try {
      const { status, text } = await proxyFetch(target, forwardHeaders, body, ignoreCert);
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(text);
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Proxy error: ${err}` }));
    }
    return true;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
  return true;
}
