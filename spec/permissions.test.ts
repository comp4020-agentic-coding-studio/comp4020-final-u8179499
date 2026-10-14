import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupAll,
  cookiePair,
  cookieValue,
  issuedCookie,
  openEvents,
  rawRequest,
  startServer,
  type TestServer,
} from "./support/server-process.ts";

// Crit 10 server-side permissions
// (decisions/0003-crit10-pseudonymous-browser-identity.md). Every visitor has
// the same rights; what the server enforces is that state only changes
// through a same-origin request, and that nothing ever exposes who someone
// else is. Origin checks are browser-forgery protection, not authentication:
// a non-browser client can send any headers it likes, and is still only ever
// another anonymous visitor.

afterEach(cleanupAll);

const json = { "Content-Type": "application/json" };

function throwAs(server: TestServer, headers: Record<string, string>, message = "permission-test") {
  return rawRequest(server.baseUrl, {
    method: "POST",
    path: "/api/bottles",
    headers: { ...json, ...headers },
    body: JSON.stringify({ message }),
  });
}

function catchAs(server: TestServer, headers: Record<string, string> = {}) {
  return rawRequest(server.baseUrl, { method: "POST", path: "/api/bottles/catch", headers });
}

async function ocean(server: TestServer): Promise<unknown> {
  return JSON.parse((await rawRequest(server.baseUrl, { path: "/api/ocean" })).body);
}

async function visitor(server: TestServer): Promise<string> {
  return cookiePair(issuedCookie(await rawRequest(server.baseUrl, { path: "/" }))!);
}

describe("public reads", () => {
  it("serves /, /readme/, /api/ocean and /api/events to anyone, with or without a cookie", async () => {
    const server = await startServer();
    const cookie = await visitor(server);
    for (const headers of [{}, { Cookie: cookie }] as Record<string, string>[]) {
      for (const path of ["/", "/readme/", "/api/ocean"]) {
        expect((await rawRequest(server.baseUrl, { path, headers })).status, path).toBe(200);
      }
      const stream = await openEvents(server.baseUrl, headers);
      expect(stream.status).toBe(200);
      stream.close();
    }
  });

  it("serves reads even when a cross-site page requests them — reading changes nothing", async () => {
    const server = await startServer();
    const res = await rawRequest(server.baseUrl, {
      path: "/api/ocean",
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(200);
    // and it grants no cross-origin read access
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("same-origin writes", () => {
  it("lets a browser Throw and Catch with a matching Origin and same-origin fetch metadata", async () => {
    const server = await startServer();
    const cookie = await visitor(server);
    const browser = { Cookie: cookie, Origin: server.baseUrl, "Sec-Fetch-Site": "same-origin" };

    const thrown = await throwAs(server, browser, "same-origin");
    expect(thrown.status).toBe(201);
    expect(thrown.body).toBe("thrown");

    const caught = await catchAs(server, browser);
    expect(caught.status).toBe(200);
    expect(JSON.parse(caught.body)).toEqual({ bottle: { message: "same-origin" } });
  });

  it("normalises the Origin it compares — case and an explicit default port still match", async () => {
    const server = await startServer({ env: { FLY_APP_NAME: "mib-spec" } });
    const res = await throwAs(server, { Origin: "HTTPS://MIB-SPEC.fly.dev:443" });
    expect(res.status).toBe(201);
  });

  it("keeps accepting non-browser clients that send no Origin and no fetch metadata", async () => {
    const server = await startServer();
    expect((await throwAs(server, {}, "curl")).status).toBe(201);
    const caught = await catchAs(server);
    expect(JSON.parse(caught.body)).toEqual({ bottle: { message: "curl" } });
  });

  it("does not require a particular Content-Type, as before Crit 10", async () => {
    const server = await startServer();
    const res = await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ message: "plain" }),
    });
    expect(res.status).toBe(201);
  });

  it("lets a visitor catch their own bottle — there is no ownership rule", async () => {
    const server = await startServer();
    const cookie = await visitor(server);
    await throwAs(server, { Cookie: cookie }, "mine");
    const caught = await catchAs(server, { Cookie: cookie });
    expect(JSON.parse(caught.body)).toEqual({ bottle: { message: "mine" } });
  });
});

describe("cross-site writes are refused", () => {
  const forged: Array<[string, Record<string, string>]> = [
    ["a different Origin", { Origin: "https://evil.example" }],
    ["Origin: null", { Origin: "null" }],
    ["an unparseable Origin", { Origin: "not a url" }],
    ["a same-host Origin on the wrong scheme", { Origin: "https://127.0.0.1" }],
    ["no Origin but cross-site fetch metadata", { "Sec-Fetch-Site": "cross-site" }],
    ["no Origin but same-site fetch metadata", { "Sec-Fetch-Site": "same-site" }],
  ];

  for (const [label, headers] of forged) {
    it(`refuses a Throw with ${label}: 403, no bottle, no event, no identity`, async () => {
      const server = await startServer();
      const stream = await openEvents(server.baseUrl);
      const res = await throwAs(server, headers);
      expect(res.status).toBe(403);
      expect(issuedCookie(res)).toBeUndefined();
      expect(await ocean(server)).toEqual({ empty: true, visualLevel: 0 });
      expect(stream.frames()).toEqual([]);
      stream.close();
    });
  }

  it("refuses a matching Origin that arrives with contradictory cross-site fetch metadata", async () => {
    const server = await startServer();
    const res = await throwAs(server, { Origin: server.baseUrl, "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
    expect(await ocean(server)).toEqual({ empty: true, visualLevel: 0 });
  });

  it("refuses a cross-site Catch without claiming the bottle or broadcasting", async () => {
    const server = await startServer();
    await throwAs(server, {}, "stays put");
    const stream = await openEvents(server.baseUrl);
    const res = await catchAs(server, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await ocean(server)).toEqual({ empty: false, visualLevel: 1 });
    expect(stream.frames()).toEqual([]);
    stream.close();
  });

  it("refuses the request even when it carries the victim's valid cookie", async () => {
    const server = await startServer();
    const cookie = await visitor(server);
    const res = await throwAs(server, { Cookie: cookie, Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("on Fly, trusts the app's own https origin, not whatever Host the request claims", async () => {
    const server = await startServer({ env: { FLY_APP_NAME: "mib-spec" } });
    const spoofed = await throwAs(server, { Host: "evil.example", Origin: "https://evil.example" });
    expect(spoofed.status).toBe(403);
    const plainHttp = await throwAs(server, { Origin: "http://mib-spec.fly.dev" });
    expect(plainHttp.status).toBe(403);
    const genuine = await throwAs(server, { Host: "evil.example", Origin: "https://mib-spec.fly.dev" });
    expect(genuine.status).toBe(201);
  });
});

describe("nothing exposes another visitor", () => {
  it("never echoes a cookie value or actor label in any page, API body or SSE frame", async () => {
    const server = await startServer();
    const a = await visitor(server);
    const b = await visitor(server);
    const stream = await openEvents(server.baseUrl, { Cookie: b });
    await throwAs(server, { Cookie: a }, "exposure-check");
    await catchAs(server, { Cookie: b });
    await stream.waitForFrames(2);

    const labels = server.logs().map((l) => l.actor).filter((x): x is string => typeof x === "string");
    expect(labels.length, "no actor labels were logged to look for").toBeGreaterThan(0);

    const surfaces = [
      ...(await Promise.all(
        ["/", "/readme/", "/api/ocean"].map(async (path) => (await rawRequest(server.baseUrl, { path, headers: { Cookie: a } })).body),
      )),
      ...stream.frames(),
    ].join("\n");
    for (const secret of [cookieValue(a), cookieValue(b), ...cookieValue(a).split("."), ...labels]) {
      if (secret.length < 8) continue;
      expect(surfaces).not.toContain(secret);
    }
    stream.close();
  });

  it("has no route for listing bottles, visitors or logs", async () => {
    const server = await startServer();
    for (const path of ["/api/bottles", "/api/logs", "/api/visitors", "/api/me", "/api/bottles/1"]) {
      expect((await rawRequest(server.baseUrl, { path })).status, path).toBe(404);
    }
  });
});
