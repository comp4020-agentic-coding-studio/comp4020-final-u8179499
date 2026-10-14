import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupAll,
  cookiePair,
  cookieValue,
  issuedCookie,
  openEvents,
  rawRequest,
  startServer,
  type LogLine,
  type TestServer,
} from "./support/server-process.ts";

// Crit 10 structured logging
// (decisions/0003-crit10-pseudonymous-browser-identity.md): one JSON object
// per stdout line, saying which pseudonymous browser did what and how it
// turned out — readable with `flyctl logs` — and never what anyone wrote or
// anything that could find them outside the app.

afterEach(cleanupAll);

const ACTOR = /^b-[0-9a-f]{16}$/;
const ALLOWED_KEYS = new Set(["ts", "evt", "actor", "outcome", "status", "reason", "cause", "port", "secret"]);

async function newVisitor(server: TestServer): Promise<{ cookie: string; actor: string }> {
  const before = server.logs().filter((l) => l.evt === "identity.issued").length;
  const res = await rawRequest(server.baseUrl, { path: "/" });
  const cookie = cookiePair(issuedCookie(res)!);
  const issued = await server.waitForLogs((l) => l.evt === "identity.issued", before + 1);
  return { cookie, actor: issued[before].actor as string };
}

function throwAs(server: TestServer, cookie: string | null, body: string) {
  return rawRequest(server.baseUrl, {
    method: "POST",
    path: "/api/bottles",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body,
  });
}

function catchAs(server: TestServer, cookie: string | null) {
  return rawRequest(server.baseUrl, {
    method: "POST",
    path: "/api/bottles/catch",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const matches = (want: Partial<LogLine>) => (line: LogLine): boolean =>
  Object.entries(want).every(([k, v]) => line[k] === v);

describe("log format", () => {
  it("writes one JSON object per stdout line, each with an ISO timestamp and an event name", async () => {
    const server = await startServer();
    const { cookie } = await newVisitor(server);
    await throwAs(server, cookie, JSON.stringify({ message: "format" }));
    await server.waitForLogs(matches({ evt: "throw" }));

    const lines = server.stdout().split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as LogLine;
      expect(typeof parsed.evt).toBe("string");
      expect(new Date(parsed.ts as string).toISOString()).toBe(parsed.ts);
      for (const key of Object.keys(parsed)) expect(ALLOWED_KEYS, `unexpected log key "${key}"`).toContain(key);
    }
  });

  it("starts with a server.start line naming the port and where the secret came from, not the secret", async () => {
    const server = await startServer();
    const [start] = await server.waitForLogs(matches({ evt: "server.start" }));
    expect(start.port).toBe(server.port);
    expect(start.secret).toBe("file");
  });
});

describe("who did what", () => {
  it("attributes Browser A's Throw and Browser B's Catch to two different, stable labels", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    const b = await newVisitor(server);
    expect(a.actor).toMatch(ACTOR);
    expect(b.actor).toMatch(ACTOR);
    expect(a.actor).not.toBe(b.actor);

    expect((await throwAs(server, a.cookie, JSON.stringify({ message: "from A" }))).status).toBe(201);
    const caught = await catchAs(server, b.cookie);
    expect(JSON.parse(caught.body).bottle.message).toBe("from A");

    const [thrown] = await server.waitForLogs(matches({ evt: "throw", outcome: "ok" }));
    const [claimed] = await server.waitForLogs(matches({ evt: "catch", outcome: "ok" }));
    expect(thrown).toMatchObject({ actor: a.actor, status: 201 });
    expect(claimed).toMatchObject({ actor: b.actor, status: 200 });
  });

  it("logs identity.issued once per new visitor, with why, and never for a returning one", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    await rawRequest(server.baseUrl, { path: "/", headers: { Cookie: a.cookie } });
    await rawRequest(server.baseUrl, { path: "/api/ocean", headers: { Cookie: a.cookie } });
    await rawRequest(server.baseUrl, { path: "/", headers: { Cookie: "mib_visitor=v1.bogus.value" } });

    const issued = await server.waitForLogs(matches({ evt: "identity.issued" }), 2);
    expect(issued).toHaveLength(2);
    expect(issued[0]).toMatchObject({ actor: a.actor, cause: "missing" });
    expect(issued[1]).toMatchObject({ cause: "invalid" });
    expect(issued[1].actor).not.toBe(a.actor);
  });

  it("gives the same browser the same label after the server restarts", async () => {
    const first = await startServer();
    const a = await newVisitor(first);
    await first.stop();

    const second = await startServer({ dir: first.dir });
    await throwAs(second, a.cookie, JSON.stringify({ message: "after restart" }));
    const [line] = await second.waitForLogs(matches({ evt: "throw", outcome: "ok" }));
    expect(line.actor).toBe(a.actor);
    expect(second.logs().some(matches({ evt: "identity.issued" }))).toBe(false);
  });

  it("records sse.open and sse.close against the browser that held the stream", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    const stream = await openEvents(server.baseUrl, { Cookie: a.cookie });
    await server.waitForLogs(matches({ evt: "sse.open", actor: a.actor }));
    stream.close();
    await server.waitForLogs(matches({ evt: "sse.close", actor: a.actor }));
  });

  it("labels a first-time stream with the identity it was just issued", async () => {
    const server = await startServer();
    const stream = await openEvents(server.baseUrl);
    const [issued] = await server.waitForLogs(matches({ evt: "identity.issued" }));
    const [opened] = await server.waitForLogs(matches({ evt: "sse.open" }));
    expect(opened.actor).toBe(issued.actor);
    stream.close();
  });
});

describe("outcomes", () => {
  it("logs successful and rejected Throws with a fixed reason and the status sent", async () => {
    const server = await startServer();
    const { cookie, actor } = await newVisitor(server);

    await throwAs(server, cookie, JSON.stringify({ message: "ok" }));
    await throwAs(server, cookie, JSON.stringify({ message: "   " }));
    await throwAs(server, cookie, JSON.stringify({ message: 42 }));
    await throwAs(server, cookie, JSON.stringify({ message: "x".repeat(281) }));
    await throwAs(server, cookie, "{not json");
    await throwAs(server, cookie, JSON.stringify({ message: "y".repeat(5000) }));

    const throws = await server.waitForLogs(matches({ evt: "throw" }), 6);
    expect(throws.map(({ outcome, reason, status }) => ({ outcome, reason, status }))).toEqual([
      { outcome: "ok", reason: undefined, status: 201 },
      { outcome: "rejected", reason: "invalid_message", status: 400 },
      { outcome: "rejected", reason: "invalid_message", status: 400 },
      { outcome: "rejected", reason: "too_long", status: 400 },
      { outcome: "rejected", reason: "invalid_json", status: 400 },
      { outcome: "rejected", reason: "too_large", status: 413 },
    ]);
    for (const line of throws) expect(line.actor).toBe(actor);
  });

  it("logs a successful Catch and an empty-ocean Catch differently", async () => {
    const server = await startServer();
    const { cookie, actor } = await newVisitor(server);
    await throwAs(server, cookie, JSON.stringify({ message: "one" }));
    await catchAs(server, cookie);
    await catchAs(server, cookie);

    const catches = await server.waitForLogs(matches({ evt: "catch" }), 2);
    expect(catches).toEqual([
      expect.objectContaining({ actor, outcome: "ok", status: 200 }),
      expect.objectContaining({ actor, outcome: "empty", status: 200 }),
    ]);
  });

  it("logs a cross-site rejection, naming the visitor only if their cookie was genuine", async () => {
    const server = await startServer();
    const { cookie, actor } = await newVisitor(server);
    await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles",
      headers: { Cookie: cookie, Origin: "https://evil.example" },
      body: JSON.stringify({ message: "csrf" }),
    });
    await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles/catch",
      headers: { Origin: "null" },
    });

    const [thrown] = await server.waitForLogs(matches({ evt: "throw" }));
    const [caught] = await server.waitForLogs(matches({ evt: "catch" }));
    expect(thrown).toMatchObject({ actor, outcome: "rejected", reason: "bad_origin", status: 403 });
    expect(caught).toMatchObject({ outcome: "rejected", reason: "bad_origin", status: 403 });
    expect(caught.actor).toBeUndefined();
  });

  it("logs one ok and one empty when two browsers race for a single bottle", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    const b = await newVisitor(server);
    const stream = await openEvents(server.baseUrl, { Cookie: a.cookie });
    await throwAs(server, a.cookie, JSON.stringify({ message: "contested" }));
    await stream.waitForFrames(1);

    const results = await Promise.all([catchAs(server, a.cookie), catchAs(server, b.cookie)]);
    const won = results.filter((r) => JSON.parse(r.body).bottle !== null);
    expect(won).toHaveLength(1);

    const catches = await server.waitForLogs(matches({ evt: "catch" }), 2);
    expect(catches.map((l) => l.outcome).sort()).toEqual(["empty", "ok"]);
    expect(new Set(catches.map((l) => l.actor))).toEqual(new Set([a.actor, b.actor]));

    await stream.waitForFrames(2);
    // give a wrongly-duplicated broadcast the chance to arrive: one more
    // round-trip through the server, which shares the event loop with it
    await rawRequest(server.baseUrl, { path: "/api/ocean" });
    expect(stream.frames().filter((f) => f.startsWith("event: caught"))).toHaveLength(1);
    stream.close();
  });
});

describe("privacy", () => {
  it("never logs message text, cookie values, signatures, secrets, IPs or bottle ids", async () => {
    const server = await startServer({ env: { IDENTITY_SECRET: "c0ffee".repeat(10) + "c0de" } });
    const secret = "c0ffee".repeat(10) + "c0de";
    const a = await newVisitor(server);
    const b = await newVisitor(server);
    const message = `private-${crypto.randomUUID()}`;
    const ipHeaders = {
      "X-Forwarded-For": "203.0.113.77",
      "Fly-Client-IP": "198.51.100.23",
      "X-Real-IP": "192.0.2.199",
      "User-Agent": "SpecAgent/9.9 (identifying-ua)",
    };

    await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles",
      headers: { ...ipHeaders, Cookie: a.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    await rawRequest(server.baseUrl, { method: "POST", path: "/api/bottles/catch", headers: { ...ipHeaders, Cookie: b.cookie } });
    await throwAs(server, a.cookie, `{"message":"${message}-broken`);
    await throwAs(server, a.cookie, JSON.stringify({ message: `${message}-${"z".repeat(3000)}` }));
    await throwAs(server, a.cookie, JSON.stringify({ message: `${message}-${"w".repeat(281)}` }));
    await rawRequest(server.baseUrl, { path: "/", headers: { ...ipHeaders, Cookie: `mib_visitor=v1.${message}.x` } });
    await server.waitForLogs(matches({ evt: "throw" }), 4);

    const out = server.stdout();
    const forbidden = [
      message,
      secret,
      cookieValue(a.cookie),
      cookieValue(b.cookie),
      ...cookieValue(a.cookie).split(".").slice(1),
      ...cookieValue(b.cookie).split(".").slice(1),
      "203.0.113.77",
      "198.51.100.23",
      "192.0.2.199",
      "127.0.0.1",
      "identifying-ua",
    ];
    for (const value of forbidden) expect(out, `stdout leaked "${value.slice(0, 40)}"`).not.toContain(value);
    for (const line of server.logs()) {
      for (const key of ["id", "bottle", "bottleId", "message", "ip", "cookie", "headers", "body"]) {
        expect(line, `log line has a "${key}" field`).not.toHaveProperty(key);
      }
    }
  });

  it("does not write identity details to stderr either", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    await throwAs(server, a.cookie, JSON.stringify({ message: "stderr-check" }));
    await server.waitForLogs(matches({ evt: "throw" }));
    expect(server.stderr()).not.toContain(cookieValue(a.cookie).split(".")[1]);
    expect(server.stderr()).not.toContain("stderr-check");
  });

  it("keeps SSE frames exactly as anonymous and payload-free as Crit 9", async () => {
    const server = await startServer();
    const a = await newVisitor(server);
    const stream = await openEvents(server.baseUrl, { Cookie: a.cookie });
    await throwAs(server, a.cookie, JSON.stringify({ message: "frame-check" }));
    await catchAs(server, a.cookie);
    expect(await stream.waitForFrames(2)).toEqual(["event: thrown\ndata:\n\n", "event: caught\ndata:\n\n"]);
    stream.close();
  });
});

describe("test helper", () => {
  it("waitForFrames resolves at once for frames already buffered, without waiting for another", async () => {
    const server = await startServer();
    const stream = await openEvents(server.baseUrl);
    await throwAs(server, null, JSON.stringify({ message: "buffered" }));
    await stream.waitForFrames(1);
    // The frame is already in hand and no more will arrive, so only an
    // immediate check can resolve this before the (deliberately short) timeout.
    expect(await stream.waitForFrames(1, 50)).toEqual(["event: thrown\ndata:\n\n"]);
    stream.close();
  });
});
