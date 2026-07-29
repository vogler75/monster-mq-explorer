const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { handleApiRequest } = require("./api.cjs");

const DIST_DIR = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT) || 3000;
const listenHost = process.env.MONSTER_MQ_HOST || "127.0.0.1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function sendFile(res, file) {
  const ext = path.extname(file);
  res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (await handleApiRequest(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const candidate = path.resolve(DIST_DIR, `.${pathname}`);
  const file = candidate.startsWith(`${DIST_DIR}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(DIST_DIR, "index.html");
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end("Build output not found. Run npm run build first.");
    return;
  }
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }
  sendFile(res, file);
});

server.listen(port, listenHost, () => {
  console.log(`Monster MQTT Explorer is running at http://${listenHost}:${port}`);
});
