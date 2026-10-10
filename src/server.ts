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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Escapes a run of plain text, then applies the only two character-level
// styles README.md uses: **bold** and *italic*. Used both for top-level
// paragraph text and inside a link's label, which is the only place
// README.md nests one inline style inside another.
function renderEmphasis(raw: string): string {
  return escapeHtml(raw)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

// Renders one block's inline Markdown: `code spans` and [text](url) links —
// the only inline elements besides bold/italic that README.md uses — then
// renderEmphasis for everything in between. Code and link-destination text
// are escaped directly rather than through renderEmphasis, so a literal `*`
// inside either can never be mistaken for emphasis syntax.
function renderInline(raw: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  const pattern = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    parts.push(renderEmphasis(raw.slice(lastIndex, match.index)));
    const [, code, label, url] = match;
    parts.push(
      code !== undefined
        ? `<code>${escapeHtml(code)}</code>`
        : `<a href="${escapeHtml(url)}">${renderEmphasis(label)}</a>`,
    );
    lastIndex = pattern.lastIndex;
  }
  parts.push(renderEmphasis(raw.slice(lastIndex)));
  return parts.join("");
}

// A minimal, dependency-free Markdown renderer for README.md specifically —
// not a general Markdown implementation. It supports exactly what README.md
// uses: ATX headings, paragraphs, bold, italic, inline code, and links.
// Anything else (lists, tables, fenced code, images, block quotes) would
// render as literal paragraph text rather than being interpreted, which is
// an accepted trade-off for staying on zero runtime dependencies (see
// PROCESS.md's stack choice) — README.md never needs them.
function renderMarkdown(markdown: string): string {
  return markdown
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const heading = block.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${renderInline(heading[2])}</h${level}>`;
      }
      return `<p>${renderInline(block)}</p>`;
    })
    .join("\n");
}

const readmeHtml = readFileSync(join(here, "html/readme.html"), "utf8").replace(
  "@README_HTML@",
  () => renderMarkdown(readFileSync(join(root, "README.md"), "utf8")),
);

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

// A thrown message is capped at 280 characters; 2048 bytes of JSON is already
// generous headroom for that, so anything past it can only be someone trying
// to make the server buffer an unbounded body. Thrown to short-circuit
// readJsonBody, never caught except in the handler that maps it to 413.
class PayloadTooLargeError extends Error {}
const MAX_BODY_BYTES = 2048;

// Reads the request body with a hard byte cap, counted from the raw chunks
// (Buffer.length is a byte count, unlike a decoded string's length once
// multi-byte UTF-8 is involved) so the cap can't be undercounted. Rejects the
// moment the cap is crossed — from a declared Content-Length over the limit,
// or from the running total on a chunked body — without reading the rest of
// the body first. Deliberately never calls req.destroy()/res.destroy(): the
// request and response share one socket, and destroying it here would take
// the 413 response down with it before it could be sent.
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      reject(new PayloadTooLargeError());
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const done = (err: unknown, value?: unknown): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        done(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        done(null, raw === "" ? {} : JSON.parse(raw));
      } catch (err) {
        done(err);
      }
    };

    const onError = (err: unknown): void => done(err);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

// Guards every response against a connection that's already gone (e.g. the
// client disconnected while its oversized body was still being rejected) —
// writing to a destroyed/ended response would otherwise throw or double-send.
function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  if (res.writableEnded || res.destroyed) return;
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
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        // The body was never fully read, so this connection can't safely be
        // reused for a pipelined next request — close it after the response.
        res.setHeader("Connection", "close");
        send(res, 413, "text/plain", "request body too large");
      } else {
        send(res, 400, "text/plain", "invalid JSON");
      }
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
