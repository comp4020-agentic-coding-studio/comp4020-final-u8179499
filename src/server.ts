import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase, throwBottle, catchBottle, oceanVisualLevel } from "./db.ts";

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

// Crit 9: every currently open GET /api/events connection, held in memory
// only. No identity, no session, no history — just "who's listening right
// now", which is exactly what lets every connected client (including the one
// that triggered the action) receive the same anonymous event.
const sseClients = new Set<ServerResponse>();

// The event payload is the action type and nothing else: no id, no message,
// no count. Removes a client the moment a write to it fails, which is the
// only signal a plain `node:http` response gives for "the other end is gone".
function broadcastEvent(type: "thrown" | "caught"): void {
  const frame = `event: ${type}\ndata:\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

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
    const visualLevel = oceanVisualLevel(db);
    sendJson(res, 200, { empty: visualLevel === 0, visualLevel });
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Node buffers headers until the first write, so without this a client
    // that connects before anyone throws or catches never even sees a
    // response — flush now, then the connection just sits open and idle
    // until a broadcast has something to send it.
    res.flushHeaders();
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
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
    broadcastEvent("thrown");
    send(res, 201, "text/plain", "thrown");
    return;
  }

  if (req.method === "POST" && pathname === "/api/bottles/catch") {
    const result = catchBottle(db);
    if (result.bottle) {
      broadcastEvent("caught");
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
