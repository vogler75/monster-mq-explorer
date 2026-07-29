const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");

const DATA_DIR = path.resolve(process.cwd(), "data");
const CONNECTIONS_FILE = path.join(DATA_DIR, "connections.json");
const MAX_BODY_BYTES = 1_000_000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readConnections() {
  ensureDataDir();
  if (!fs.existsSync(CONNECTIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeConnections(data) {
  ensureDataDir();
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function proxyFetch(target, headers, body, ignoreCert) {
  const url = new URL(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) proxy targets are allowed");
  }
  if (!ignoreCert) {
    return fetch(url, { method: "POST", headers, body })
      .then(async (response) => ({ status: response.status, text: await response.text() }));
  }

  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const bodyBuf = Buffer.from(body);
    const request = (isHttps ? https : http).request({
      hostname: url.hostname,
      port: url.port || (isHttps ? "443" : "80"),
      path: url.pathname + url.search,
      method: "POST",
      headers: { ...headers, "Content-Length": String(bodyBuf.length) },
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 200,
        text: Buffer.concat(chunks).toString(),
      }));
    });
    request.on("error", reject);
    request.end(bodyBuf);
  });
}

async function handleApiRequest(req, res) {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;

  res.setHeader("Content-Type", "application/json");

  if (url === "/api/connections" && req.method === "GET") {
    res.end(JSON.stringify(readConnections()));
    return true;
  }

  if (url === "/api/connections" && req.method === "PUT") {
    try {
      const data = JSON.parse(await readBody(req));
      if (!Array.isArray(data)) throw new Error("Expected array");
      writeConnections(data);
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid JSON" }));
    }
    return true;
  }

  if (url === "/api/winccua-proxy" && req.method === "POST") {
    const target = req.headers["x-wincc-target"];
    if (typeof target !== "string") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing X-Wincc-Target header" }));
      return true;
    }
    try {
      const body = await readBody(req);
      const headers = { "Content-Type": "application/json" };
      const auth = req.headers.authorization;
      if (auth) headers.Authorization = Array.isArray(auth) ? auth[0] : auth;
      const { status, text } = await proxyFetch(target, headers, body, req.headers["x-ignore-cert-errors"] === "1");
      res.statusCode = status;
      res.end(text);
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `Proxy error: ${error}` }));
    }
    return true;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
  return true;
}

module.exports = { handleApiRequest };
