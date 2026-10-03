import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase, throwBottle, catchBottle, oceanIsEmpty } from "./db.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PORT = Number(process.env.PORT ?? 8080);
// /data is the volume fly.toml mounts; DB_PATH lets tests and local runs point
// elsewhere so they never touch a real deployed volume.
const DB_PATH = process.env.DB_PATH ?? "/data/bottles.db";

const db = openDatabase(DB_PATH);

const indexHtml = readFileSync(join(here, "html/index.html"), "utf8");

const readmeBody = readFileSync(join(root, "README.md"), "utf8")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");
const readmeHtml = readFileSync(join(here, "html/readme.html"), "utf8").replace("@README@", readmeBody);

const MAX_MESSAGE_LENGTH = 280;
const EMPTY_OCEAN_MESSAGE = "The ocean is quiet. No bottles to catch yet.";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw === "" ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json", JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && pathname === "/") {
    send(res, 200, "text/html", indexHtml);
    return;
  }

  if (req.method === "GET" && pathname === "/readme/") {
    send(res, 200, "text/html", readmeHtml);
    return;
  }

  if (req.method === "GET" && pathname === "/api/ocean") {
    sendJson(res, 200, { empty: oceanIsEmpty(db) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/bottles") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      send(res, 400, "text/plain", "invalid JSON");
      return;
    }
    const message = typeof (body as { message?: unknown })?.message === "string"
      ? (body as { message: string }).message.trim()
      : "";
    if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      send(res, 400, "text/plain", "message must be 1-280 characters after trimming");
      return;
    }
    throwBottle(db, message);
    send(res, 201, "text/plain", "thrown");
    return;
  }

  if (req.method === "POST" && pathname === "/api/bottles/catch") {
    const result = catchBottle(db);
    if (result.bottle) {
      sendJson(res, 200, { bottle: result.bottle });
    } else {
      sendJson(res, 200, { bottle: null, message: EMPTY_OCEAN_MESSAGE });
    }
    return;
  }

  send(res, 404, "text/plain", "not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${PORT}, db at ${DB_PATH}`);
});
