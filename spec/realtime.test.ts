import { afterEach, beforeEach, expect, inject, it } from "vitest";

// Crit 9 realtime contract. Two different things are being specified here:
//
// Product behaviour, decided by the ADR
// (decisions/0001-crit9-realtime-multiuser-behaviour.md): every successful
// Throw or Catch produces an anonymous, ephemeral event — `thrown` or
// `caught` — to every currently connected client, exposing no identity, no
// message text, no bottle ID, and no count. The ADR deliberately leaves
// transport unspecified.
//
// Implementation choice for Crit 9, not mandated by the ADR: we are now
// choosing SSE as that transport, served at `GET /api/events`. That endpoint
// does not exist yet, so every test below is expected to fail (red) at
// connection time until it's implemented — not from a syntax or setup error.
const baseUrl = inject("baseUrl");

async function throwBottle(message: string): Promise<Response> {
  return fetch(new URL("/api/bottles", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

async function catchBottle(): Promise<Response> {
  return fetch(new URL("/api/bottles/catch", baseUrl), { method: "POST" });
}

// Same draining strategy as spec/bottles.test.ts: catching is random, so
// every test starts from a known-empty ocean rather than searching for a
// specific bottle.
async function drainOcean(): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    const res = await catchBottle();
    const body = await res.json();
    if (body.bottle === null) return;
  }
  throw new Error(
    "ocean did not drain after 1000 catches — is something else throwing bottles concurrently?",
  );
}

const uniqueMessage = (label: string): string => `${label}-${crypto.randomUUID()}`;

interface RealtimeEvent {
  type: string;
  raw: string;
}

// Connects to the realtime stream and parses the standard SSE
// "event: <type>\ndata: <payload>\n\n" framing. Deliberately minimal: this
// is a test helper, not production client code, and adds no dependency.
class RealtimeClient {
  private events: RealtimeEvent[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private buffer = "";

  static async connect(baseUrl: string): Promise<RealtimeClient> {
    const client = new RealtimeClient();
    const res = await fetch(new URL("/api/events", baseUrl), {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status, "GET /api/events should open a realtime stream (200)").toBe(200);
    expect(
      res.headers.get("content-type") ?? "",
      "GET /api/events should respond as an SSE stream",
    ).toContain("text/event-stream");
    if (!res.body) throw new Error("GET /api/events returned no readable body");
    client.reader = res.body.getReader();
    void client.consume();
    return client;
  }

  private async consume(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      this.buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
        const frame = this.buffer.slice(0, sep);
        this.buffer = this.buffer.slice(sep + 2);
        const typeLine = frame.split("\n").find((l) => l.startsWith("event:"));
        const type = typeLine ? typeLine.slice("event:".length).trim() : "message";
        this.events.push({ type, raw: frame });
      }
    }
  }

  // Polls its own already-collected events until `count` of `type` have
  // arrived, or gives up at `timeoutMs` — generous enough for local/CI
  // jitter around the ~1s product requirement, without hanging on a true red.
  async waitFor(type: string, count: number, timeoutMs: number): Promise<RealtimeEvent[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const matches = this.events.filter((e) => e.type === type);
      if (matches.length >= count) return matches;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.events.filter((e) => e.type === type);
  }

  all(): readonly RealtimeEvent[] {
    return this.events;
  }

  close(): void {
    this.reader?.cancel().catch(() => {});
  }
}

let client: RealtimeClient | undefined;

beforeEach(async () => {
  await drainOcean();
});

afterEach(() => {
  client?.close();
  client = undefined;
});

it("a successful Throw broadcasts exactly one `thrown` event to an already-connected client", async () => {
  client = await RealtimeClient.connect(baseUrl);

  const res = await throwBottle(uniqueMessage("rt-throw"));
  expect(res.status).toBe(201);

  const thrown = await client.waitFor("thrown", 1, 2000);
  expect(
    thrown,
    `expected exactly one \`thrown\` event, saw: ${JSON.stringify(client.all())}`,
  ).toHaveLength(1);
});

it("a successful Catch broadcasts exactly one `caught` event to an already-connected client", async () => {
  await throwBottle(uniqueMessage("rt-catch"));
  client = await RealtimeClient.connect(baseUrl);

  const res = await catchBottle();
  const body = await res.json();
  expect(body.bottle).not.toBeNull();

  const caught = await client.waitFor("caught", 1, 2000);
  expect(
    caught,
    `expected exactly one \`caught\` event, saw: ${JSON.stringify(client.all())}`,
  ).toHaveLength(1);
});

it("the realtime event exposes only the action type — never message text, bottle id, count, or identity", async () => {
  client = await RealtimeClient.connect(baseUrl);

  const message = uniqueMessage("rt-secret");
  await throwBottle(message);
  const [thrownEvent] = await client.waitFor("thrown", 1, 2000);
  expect(thrownEvent, "no `thrown` event arrived to inspect").toBeDefined();
  expect(thrownEvent.raw).not.toContain(message);
  expect(thrownEvent.raw.toLowerCase()).not.toMatch(/\bid\b/);
  expect(thrownEvent.raw.toLowerCase()).not.toMatch(/count/);
  expect(thrownEvent.raw.toLowerCase()).not.toMatch(/session/);
  expect(thrownEvent.raw.toLowerCase()).not.toMatch(/user/);

  const catchRes = await catchBottle();
  const caughtBody = await catchRes.json();
  expect(caughtBody.bottle?.message).toBe(message);

  const [caughtEvent] = await client.waitFor("caught", 1, 2000);
  expect(caughtEvent, "no `caught` event arrived to inspect").toBeDefined();
  expect(caughtEvent.raw).not.toContain(message);
  expect(caughtEvent.raw.toLowerCase()).not.toMatch(/\bid\b/);
  expect(caughtEvent.raw.toLowerCase()).not.toMatch(/count/);
  expect(caughtEvent.raw.toLowerCase()).not.toMatch(/session/);
  expect(caughtEvent.raw.toLowerCase()).not.toMatch(/user/);
});

it("an unsuccessful Catch against an empty ocean emits no `caught` event", async () => {
  client = await RealtimeClient.connect(baseUrl);

  const res = await catchBottle();
  const body = await res.json();
  expect(body.bottle).toBeNull();

  const caught = await client.waitFor("caught", 1, 500);
  expect(caught, "an unsuccessful catch must not emit a `caught` event").toHaveLength(0);
});

it("concurrent Catch attempts on one bottle produce exactly one successful Catch and exactly one `caught` event", async () => {
  const message = uniqueMessage("rt-concurrent");
  await throwBottle(message);
  client = await RealtimeClient.connect(baseUrl);

  const responses = await Promise.all(Array.from({ length: 8 }, () => catchBottle()));
  const bodies = await Promise.all(responses.map((r) => r.json()));
  const winners = bodies.filter((b) => b.bottle !== null);
  expect(winners).toHaveLength(1);

  const caught = await client.waitFor("caught", 1, 2000);
  expect(
    caught,
    `expected exactly one \`caught\` event for the one successful catch, saw: ${JSON.stringify(client.all())}`,
  ).toHaveLength(1);
});

// Guard, not a red spec: this must already pass and must keep passing.
// decisions/0002-ambient-bottle-population-visibility.md is a deliberate,
// narrow widening of the Crit 8 durable-state shape (adds a capped
// `visualLevel`, never an exact count past 3) — this guard now locks *that*
// shape instead of the pre-0002 one, so any further widening is caught here
// too.
it("GET /api/ocean stays exactly { empty: boolean, visualLevel }, capped at 3 — ADR 0002 does not widen it further", async () => {
  const res = await fetch(new URL("/api/ocean", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["empty", "visualLevel"]);
  expect(typeof body.empty).toBe("boolean");
  expect([0, 1, 2, 3, "many"]).toContain(body.visualLevel);
  expect(body.empty).toBe(body.visualLevel === 0);
});
