import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

// Crit 10 (decisions/0003-crit10-pseudonymous-browser-identity.md): one
// structured line per event on stdout, which is what `flyctl logs` shows.
// Callers pass only fixed vocabulary — event names, outcomes, reasons,
// statuses and actor labels — never request content, headers or errors.
type LogValue = string | number | undefined;
function log(evt: string, fields: Record<string, LogValue> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), evt, ...fields }));
}

// The key that signs visitor cookies and derives their log labels. It has to
// outlive restarts and redeploys or every browser would become a stranger, so
// by default it's created once beside the database, on the same volume.
// IDENTITY_SECRET overrides that; an in-memory database gets an in-memory
// key, so a throwaway run never writes a secret into the working directory.
// A secret that exists but can't be used stops the server rather than being
// quietly replaced, which would silently re-identify everyone.
const SECRET_HEX = /^[0-9a-f]{64}$/i;

function loadIdentitySecret(dbPath: string): { key: Buffer; source: "env" | "file" | "memory" } {
  const configured = process.env.IDENTITY_SECRET;
  if (configured !== undefined) {
    if (!SECRET_HEX.test(configured)) {
      throw new Error("IDENTITY_SECRET must be exactly 64 hex characters (256 bits)");
    }
    return { key: Buffer.from(configured, "hex"), source: "env" };
  }
  if (dbPath === ":memory:") return { key: randomBytes(32), source: "memory" };

  const path = join(dirname(dbPath), "identity-secret");
  const fresh = randomBytes(32).toString("hex");
  try {
    // "wx" creates the file only if it doesn't exist yet, so a second server
    // can never overwrite the first one's key.
    writeFileSync(path, `${fresh}\n`, { flag: "wx", mode: 0o600 });
    return { key: Buffer.from(fresh, "hex"), source: "file" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const stored = readFileSync(path, "utf8").trim();
  if (!SECRET_HEX.test(stored)) {
    throw new Error(`identity secret at ${path} is not 64 hex characters; refusing to replace it`);
  }
  return { key: Buffer.from(stored, "hex"), source: "file" };
}

let identity: ReturnType<typeof loadIdentitySecret>;
try {
  identity = loadIdentitySecret(DB_PATH);
} catch (err) {
  console.error(`cannot start: ${(err as Error).message}`);
  process.exit(1);
}

// On Fly the app is only ever reached as https://<app>.fly.dev (fly.toml sets
// force_https), and FLY_APP_NAME is set by Fly's runtime, not by anything a
// request can influence — so it, not X-Forwarded-Proto, decides both the
// Secure flag and the one origin allowed to write.
const FLY_APP_NAME = process.env.FLY_APP_NAME;
const PUBLIC_ORIGIN = FLY_APP_NAME ? `https://${FLY_APP_NAME}.fly.dev` : null;

// A visitor is a 128-bit random id the server signed: `v1.<id>.<mac>`, both
// base64url. The cookie is HttpOnly, so page script never sees it, and the
// label in the logs is a separate keyed hash — knowing someone's label gives
// no way back to their cookie. Visitors carry no rights beyond any other.
const VISITOR_COOKIE = "mib_visitor";
const VISITOR_MAX_AGE = 30 * 24 * 60 * 60;
const VISITOR_SHAPE = /^v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

function visitorMac(id: string): string {
  return createHmac("sha256", identity.key).update(`mib_visitor/v1/mac:${id}`).digest("base64url");
}

function actorLabel(id: string): string {
  return `b-${createHmac("sha256", identity.key).update(`mib_visitor/v1/label:${id}`).digest("hex").slice(0, 16)}`;
}

// The genuine visitor id this request carries, if any. Every mib_visitor
// value is checked (a browser can end up sending more than one) and the first
// that verifies wins; anything else — unsigned, wrong version, wrong length,
// signed with another key — is "invalid", never a partial identity.
function readVisitor(req: IncomingMessage): { id: string } | { id: null; cause: "missing" | "invalid" } {
  let sawCookie = false;
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== VISITOR_COOKIE) continue;
    sawCookie = true;
    const match = VISITOR_SHAPE.exec(part.slice(eq + 1).trim());
    if (!match) continue;
    const [, id, mac] = match;
    if (timingSafeEqual(Buffer.from(mac), Buffer.from(visitorMac(id)))) return { id };
  }
  return { id: null, cause: sawCookie ? "invalid" : "missing" };
}

// Returns this request's actor label, issuing a new identity first if it
// didn't bring a genuine one. Must run before any response header is sent.
function ensureVisitor(req: IncomingMessage, res: ServerResponse): string {
  const visitor = readVisitor(req);
  if (visitor.id !== null) return actorLabel(visitor.id);

  const id = randomBytes(16).toString("base64url");
  const attributes = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${VISITOR_MAX_AGE}`];
  if (PUBLIC_ORIGIN) attributes.push("Secure");
  res.setHeader("Set-Cookie", `${VISITOR_COOKIE}=v1.${id}.${visitorMac(id)}; ${attributes.join("; ")}`);
  const actor = actorLabel(id);
  log("identity.issued", { actor, cause: visitor.cause });
  return actor;
}

// The label of a genuine visitor, without ever issuing one — for requests the
// server is refusing.
function existingActor(req: IncomingMessage): string | undefined {
  const visitor = readVisitor(req);
  return visitor.id === null ? undefined : actorLabel(visitor.id);
}

// Whether a state-changing request could have come from this app's own page.
// This is protection against another site making a visitor's browser act,
// not authentication: a non-browser client can claim any headers it likes,
// and that's fine, because it's only ever one more anonymous visitor. A
// browser always marks a cross-site request (Sec-Fetch-Site, or an Origin
// that isn't ours — including the opaque "null"); a request with neither
// header isn't one a browser made from another site.
function isSameOriginWrite(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  // Locally there's no fixed public name, and the app serves plain http, so
  // the host the client connected to is the origin its page would have.
  let expected: string;
  try {
    expected = PUBLIC_ORIGIN ?? new URL(`http://${req.headers.host ?? ""}`).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

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
    ensureVisitor(req, res);
    send(res, 200, "text/html", indexHtml);
    return;
  }

  if (req.method === "GET" && pathname === "/readme/") {
    ensureVisitor(req, res);
    send(res, 200, "text/html", readmeHtml);
    return;
  }

  if (req.method === "GET" && pathname === "/api/ocean") {
    ensureVisitor(req, res);
    const visualLevel = oceanVisualLevel(db);
    sendJson(res, 200, { empty: visualLevel === 0, visualLevel });
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    // Before writeHead/flushHeaders: once the stream's headers are out, a
    // first-time visitor could no longer be given a cookie.
    const actor = ensureVisitor(req, res);
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
    log("sse.open", { actor });
    req.on("close", () => {
      sseClients.delete(res);
      log("sse.close", { actor });
    });
    return;
  }

  // Both writes refuse anything a browser marks as coming from another site,
  // before reading the body, issuing an identity or touching the ocean.
  const isWrite = req.method === "POST" && (pathname === "/api/bottles" || pathname === "/api/bottles/catch");
  if (isWrite && !isSameOriginWrite(req)) {
    log(pathname === "/api/bottles" ? "throw" : "catch", {
      actor: existingActor(req),
      outcome: "rejected",
      reason: "bad_origin",
      status: 403,
    });
    res.setHeader("Connection", "close");
    send(res, 403, "text/plain", "cross-origin request refused");
    return;
  }

  if (req.method === "POST" && pathname === "/api/bottles") {
    const actor = ensureVisitor(req, res);
    const rejected = (status: number, reason: string): void =>
      log("throw", { actor, outcome: "rejected", reason, status });
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        // The body was never fully read, so this connection can't safely be
        // reused for a pipelined next request — close it after the response.
        res.setHeader("Connection", "close");
        send(res, 413, "text/plain", "request body too large");
        rejected(413, "too_large");
      } else {
        send(res, 400, "text/plain", "invalid JSON");
        rejected(400, "invalid_json");
      }
      return;
    }
    const message = typeof (body as { message?: unknown })?.message === "string"
      ? (body as { message: string }).message.trim()
      : "";
    if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      send(res, 400, "text/plain", "message must be 1-280 characters after trimming");
      rejected(400, message.length === 0 ? "invalid_message" : "too_long");
      return;
    }
    throwBottle(db, message);
    broadcastEvent("thrown");
    send(res, 201, "text/plain", "thrown");
    log("throw", { actor, outcome: "ok", status: 201 });
    return;
  }

  if (req.method === "POST" && pathname === "/api/bottles/catch") {
    const actor = ensureVisitor(req, res);
    const result = catchBottle(db);
    if (result.bottle) {
      broadcastEvent("caught");
      sendJson(res, 200, { bottle: result.bottle });
      log("catch", { actor, outcome: "ok", status: 200 });
    } else {
      // "empty" covers both a quiet ocean and losing a race for the last
      // bottle: the atomic UPDATE can't tell them apart, and neither can this.
      sendJson(res, 200, { bottle: null, message: EMPTY_OCEAN_MESSAGE });
      log("catch", { actor, outcome: "empty", status: 200 });
    }
    return;
  }

  send(res, 404, "text/plain", "not found");
});

server.listen(PORT, "0.0.0.0", () => {
  log("server.start", { port: PORT, secret: identity.source });
});
