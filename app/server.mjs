#!/usr/bin/env node
// Zero-dependency static file server for the comparison view. Serves the
// whole repo root so the app can fetch() the knowledge base directly from
// /data/* — the same files the validator and (later) the tracker read —
// with no build step and no copy/sync to keep in sync.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function dirname(p) {
  return p.slice(0, p.lastIndexOf(sep));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const relPath = urlPath === "/" ? "/app/index.html" : urlPath;
  const filePath = normalize(join(root, relPath));

  if (!filePath.startsWith(root + sep) && filePath !== root) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

const port = Number(process.env.PORT ?? 4321);
server.listen(port, () => {
  console.log(`Comparison view running at http://localhost:${port}/`);
  console.log(`Serving repo root from ${root} (so /data/* and /app/* both resolve).`);
});
