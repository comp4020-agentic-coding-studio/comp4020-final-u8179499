import { beforeEach, expect, inject, it } from "vitest";

// The Crit 8 API contract these tests hold the app to:
//   POST /api/bottles        { message } -> 201 on success, 400 on empty/>280 chars
//   POST /api/bottles/catch  -> 200, { bottle: {...} | null, message?: "..." }
// Catch is POST because it mutates state (sets caught_at).
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

const EMPTY_OCEAN_MESSAGE = "The ocean is quiet. No bottles to catch yet.";

// Catching is random, so tests can't rely on order or on "keep catching until
// the expected bottle turns up" — that would be flaky and would hide a
// selection bug. Instead every test starts from a known-empty ocean: drain
// whatever's left over from a previous run, then throw exactly the bottle(s)
// a test needs. After draining, at most one bottle exists at a time, so a
// single catch is deterministic, not a search.
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

beforeEach(async () => {
  await drainOcean();
});

it("throwing a valid message persists a bottle", async () => {
  const message = uniqueMessage("test-1");

  const throwRes = await throwBottle(message);
  expect(throwRes.status).toBe(201);

  // A separate, later request — not the same call that wrote it — has to be
  // able to read it back. That's what proves it's persisted, not just held in
  // the throw request's own memory.
  const catchRes = await catchBottle();
  expect(catchRes.status).toBe(200);
  const body = await catchRes.json();
  expect(body.bottle?.message).toBe(message);
});

it("rejects empty or over-280-character messages", async () => {
  const empty = await throwBottle("");
  expect(empty.status).toBe(400);

  const tooLong = await throwBottle("a".repeat(281));
  expect(tooLong.status).toBe(400);
});

it("catching returns exactly one bottle, never a list", async () => {
  const message = uniqueMessage("test-3");
  await throwBottle(message);

  const res = await catchBottle();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.bottle).not.toBeNull();
  expect(body.bottle.message).toBe(message);
  expect(Array.isArray(body.bottle)).toBe(false);
  expect(body).not.toHaveProperty("bottles");
});

it("a caught bottle cannot be caught again", async () => {
  const message = uniqueMessage("test-4");
  await throwBottle(message);

  const first = await catchBottle();
  const firstBody = await first.json();
  expect(firstBody.bottle?.message).toBe(message);

  const second = await catchBottle();
  expect(second.status).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.bottle).toBeNull();
  expect(secondBody.message).toBe(EMPTY_OCEAN_MESSAGE);
});

it("concurrent catches on one bottle: exactly one wins", async () => {
  const message = uniqueMessage("test-5");
  await throwBottle(message);

  const responses = await Promise.all(Array.from({ length: 8 }, () => catchBottle()));
  const bodies = await Promise.all(responses.map((r) => r.json()));

  const winners = bodies.filter((b) => b.bottle !== null);
  expect(winners).toHaveLength(1);
  expect(winners[0].bottle.message).toBe(message);

  const losers = bodies.filter((b) => b.bottle === null);
  expect(losers).toHaveLength(bodies.length - 1);
  for (const loser of losers) {
    expect(loser.message).toBe(EMPTY_OCEAN_MESSAGE);
  }
});

it("an empty ocean returns the defined empty state without crashing", async () => {
  const res = await catchBottle();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.bottle).toBeNull();
  expect(body.message).toBe(EMPTY_OCEAN_MESSAGE);
});

// The visible trace: GET /api/ocean says only whether any uncaught bottle
// exists, so a returning visitor can see the shared ocean persisted without
// learning how many bottles, which ones, or what they say.
async function ocean(): Promise<Record<string, unknown>> {
  const res = await fetch(new URL("/api/ocean", baseUrl));
  expect(res.status).toBe(200);
  return res.json();
}

it("the ocean reports only whether uncaught bottles exist", async () => {
  expect(await ocean()).toEqual({ empty: true, visualLevel: 0 });

  await throwBottle(uniqueMessage("test-7"));
  expect(await ocean()).toEqual({ empty: false, visualLevel: 1 });

  const caught = await (await catchBottle()).json();
  expect(caught.bottle).not.toBeNull();
  expect(await ocean()).toEqual({ empty: true, visualLevel: 0 });
});

// decisions/0002-ambient-bottle-population-visibility.md: the ambient bottle
// display needs to tell 0/1/2/3 apart exactly, and anything from 4 up is
// capped to a single "many" bucket — never an exact number past 3.
it("the ocean's visualLevel is exact for 0-3 uncaught bottles, then caps at \"many\"", async () => {
  expect((await ocean()).visualLevel).toBe(0);

  const messages = Array.from({ length: 5 }, (_, i) => uniqueMessage(`test-level-${i}`));
  for (const [i, message] of messages.entries()) {
    await throwBottle(message);
    const expected = i < 3 ? i + 1 : "many";
    expect((await ocean()).visualLevel).toBe(expected);
  }

  // one more on top of "many" (6 uncaught total) must still read as "many"
  await throwBottle(uniqueMessage("test-level-extra"));
  expect((await ocean()).visualLevel).toBe("many");

  // catch down from 6 to 3 — still "many" the whole way until it drops below 4
  await catchBottle();
  await catchBottle();
  await catchBottle();
  expect((await ocean()).visualLevel).toBe(3);

  // draining the rest passes back through the exact 2/1/0 states
  for (const expected of [2, 1, 0] as const) {
    await catchBottle();
    expect((await ocean()).visualLevel).toBe(expected);
  }
});

// Not covered here, and not coverable by this harness: whether a thrown
// bottle is still catchable after the app restarts or redeploys (real disk
// persistence vs. an in-memory store that happens to survive one test run).
// spec/global-setup.ts waits for one already-running instance and never
// restarts it mid-run, so that's a manual check at deploy time, not a test.
