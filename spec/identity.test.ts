import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupAll,
  cookiePair,
  cookieValue,
  issuedCookie,
  makeTempDir,
  openEvents,
  rawRequest,
  startExpectingFailure,
  startServer,
  type TestServer,
} from "./support/server-process.ts";

// Crit 10 pseudonymous browser identity
// (decisions/0003-crit10-pseudonymous-browser-identity.md). Every test here
// runs against its own spawned server on a temp directory — see
// spec/support/server-process.ts — never the shared APP_URL app, because
// these checks restart the server and inspect where it keeps its secret.

const COOKIE_SHAPE = /^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const FIXED_SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

afterEach(cleanupAll);

async function firstVisit(server: TestServer, path = "/"): Promise<string> {
  const res = await rawRequest(server.baseUrl, { path });
  const setCookie = issuedCookie(res);
  expect(setCookie, `GET ${path} with no cookie should issue mib_visitor`).toBeDefined();
  return setCookie!;
}

describe("issuing an identity", () => {
  it("gives two first-time visitors different signed cookies", async () => {
    const server = await startServer();
    const a = cookieValue(await firstVisit(server));
    const b = cookieValue(await firstVisit(server));
    expect(a).toMatch(COOKIE_SHAPE);
    expect(b).toMatch(COOKIE_SHAPE);
    expect(a).not.toBe(b);
    // different random ids, not just different signatures over one id
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("sets HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age, without Secure on local http", async () => {
    const server = await startServer();
    const attrs = (await firstVisit(server)).split(";").slice(1).map((a) => a.trim());
    expect(attrs).toContain("HttpOnly");
    expect(attrs).toContain("SameSite=Lax");
    expect(attrs).toContain("Path=/");
    expect(attrs).toContain("Max-Age=2592000");
    expect(attrs).not.toContain("Secure");
  });

  it("does not trust X-Forwarded-Proto to turn Secure on locally", async () => {
    const server = await startServer();
    const res = await rawRequest(server.baseUrl, { path: "/", headers: { "X-Forwarded-Proto": "https" } });
    expect(issuedCookie(res)!.split(";").map((a) => a.trim())).not.toContain("Secure");
  });

  it("marks the cookie Secure when running on Fly, whatever X-Forwarded-Proto claims", async () => {
    const server = await startServer({ env: { FLY_APP_NAME: "mib-spec" } });
    const res = await rawRequest(server.baseUrl, { path: "/", headers: { "X-Forwarded-Proto": "http" } });
    expect(issuedCookie(res)!.split(";").map((a) => a.trim())).toContain("Secure");
  });

  it("issues an identity on every public GET and on direct API POSTs from a first-time client", async () => {
    const server = await startServer();
    for (const path of ["/", "/readme/", "/api/ocean"]) {
      await firstVisit(server, path);
    }
    const thrown = await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "first contact" }),
    });
    expect(thrown.status).toBe(201);
    expect(issuedCookie(thrown)).toBeDefined();

    const caught = await rawRequest(server.baseUrl, { method: "POST", path: "/api/bottles/catch" });
    expect(caught.status).toBe(200);
    expect(issuedCookie(caught)).toBeDefined();
  });

  it("puts the cookie in /api/events' response headers, before the stream starts", async () => {
    const server = await startServer();
    const stream = await openEvents(server.baseUrl);
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe("text/event-stream");
    expect(cookieValue(issuedCookie(stream)!)).toMatch(COOKIE_SHAPE);
    stream.close();
  });

  it("does not issue an identity on a 404", async () => {
    const server = await startServer();
    const res = await rawRequest(server.baseUrl, { path: "/no-such-page" });
    expect(res.status).toBe(404);
    expect(issuedCookie(res)).toBeUndefined();
  });
});

describe("keeping an identity", () => {
  it("accepts a valid cookie on every route without reissuing it", async () => {
    const server = await startServer();
    const cookie = cookiePair(await firstVisit(server));
    const headers = { Cookie: cookie };

    for (const path of ["/", "/readme/", "/api/ocean"]) {
      expect(issuedCookie(await rawRequest(server.baseUrl, { path, headers })), path).toBeUndefined();
    }
    const stream = await openEvents(server.baseUrl, headers);
    expect(issuedCookie(stream)).toBeUndefined();
    stream.close();

    const thrown = await rawRequest(server.baseUrl, {
      method: "POST",
      path: "/api/bottles",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "kept" }),
    });
    expect(thrown.status).toBe(201);
    expect(issuedCookie(thrown)).toBeUndefined();
    const caught = await rawRequest(server.baseUrl, { method: "POST", path: "/api/bottles/catch", headers });
    expect(issuedCookie(caught)).toBeUndefined();
  });

  it("finds the identity among other cookies the browser sends", async () => {
    const server = await startServer();
    const cookie = cookiePair(await firstVisit(server));
    const res = await rawRequest(server.baseUrl, {
      path: "/",
      headers: { Cookie: `theme=dark; ${cookie}; other=1` },
    });
    expect(issuedCookie(res)).toBeUndefined();
  });

  it("keeps the same identity valid after the server restarts on the same volume", async () => {
    const first = await startServer();
    const cookie = cookiePair(await firstVisit(first));
    await first.stop();

    const second = await startServer({ dir: first.dir });
    const res = await rawRequest(second.baseUrl, { path: "/", headers: { Cookie: cookie } });
    expect(issuedCookie(res)).toBeUndefined();
  });

  it("keeps the same identity valid across restarts when the secret comes from IDENTITY_SECRET", async () => {
    const first = await startServer({ env: { IDENTITY_SECRET: FIXED_SECRET } });
    const cookie = cookiePair(await firstVisit(first));
    await first.stop();

    // a different volume entirely: only the configured secret carries over
    const second = await startServer({ env: { IDENTITY_SECRET: FIXED_SECRET } });
    const res = await rawRequest(second.baseUrl, { path: "/", headers: { Cookie: cookie } });
    expect(issuedCookie(res)).toBeUndefined();
  });
});

describe("rejecting identities the server did not issue", () => {
  async function expectReissued(server: TestServer, cookieHeader: string): Promise<void> {
    const res = await rawRequest(server.baseUrl, { path: "/", headers: { Cookie: cookieHeader } });
    expect(res.status).toBe(200);
    const fresh = issuedCookie(res);
    expect(fresh, `"${cookieHeader.slice(0, 60)}" should have been replaced`).toBeDefined();
    expect(cookieValue(fresh!)).toMatch(COOKIE_SHAPE);
    expect(`mib_visitor=${cookieValue(fresh!)}`).not.toBe(cookieHeader);
  }

  it("replaces a cookie whose signature has been tampered with", async () => {
    const server = await startServer();
    const value = cookieValue(await firstVisit(server));
    const [version, id, mac] = value.split(".");
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    await expectReissued(server, `mib_visitor=${version}.${id}.${flipped}`);
  });

  it("replaces a cookie whose id has been swapped under a valid signature", async () => {
    const server = await startServer();
    const a = cookieValue(await firstVisit(server)).split(".");
    const b = cookieValue(await firstVisit(server)).split(".");
    await expectReissued(server, `mib_visitor=v1.${a[1]}.${b[2]}`);
  });

  it("replaces a cookie signed with a different secret", async () => {
    const other = await startServer({ env: { IDENTITY_SECRET: OTHER_SECRET } });
    const foreign = cookiePair(await firstVisit(other));
    const server = await startServer({ env: { IDENTITY_SECRET: FIXED_SECRET } });
    await expectReissued(server, foreign);
  });

  it("does not treat a well-formed but unsigned id as an identity", async () => {
    const server = await startServer();
    const id = cookieValue(await firstVisit(server)).split(".")[1];
    await expectReissued(server, `mib_visitor=${id}`);
    await expectReissued(server, `mib_visitor=v1.${id}`);
    await expectReissued(server, `mib_visitor=v1.${id}.`);
  });

  it("replaces malformed, wrong-version and oversized values without erroring", async () => {
    const server = await startServer();
    const good = cookieValue(await firstVisit(server));
    for (const bad of [
      "",
      "garbage",
      "v1..",
      `v2.${good.slice(3)}`,
      `${good}.extra`,
      "v1.%%%%%%%%%%%%%%%%%%%%%%.%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
      `v1.${"A".repeat(4000)}.${"B".repeat(4000)}`,
    ]) {
      await expectReissued(server, `mib_visitor=${bad}`);
    }
  });

  it("ignores a forged duplicate and keeps the genuine identity when both are sent", async () => {
    const server = await startServer();
    const genuine = cookiePair(await firstVisit(server));
    const res = await rawRequest(server.baseUrl, {
      path: "/",
      headers: { Cookie: `mib_visitor=v1.forged; ${genuine}` },
    });
    expect(issuedCookie(res)).toBeUndefined();
  });
});

describe("the identity secret", () => {
  it("is created once beside the database, 256 bits, readable only by the server's user", async () => {
    const server = await startServer();
    const path = join(server.dir, "identity-secret");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const before = readFileSync(path, "utf8");
    await server.stop();
    await startServer({ dir: server.dir });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("is not written to disk when IDENTITY_SECRET is set", async () => {
    const server = await startServer({ env: { IDENTITY_SECRET: FIXED_SECRET } });
    expect(existsSync(join(server.dir, "identity-secret"))).toBe(false);
  });

  it("refuses to start rather than replace an existing secret file it cannot use", async () => {
    const dir = makeTempDir();
    const path = join(dir, "identity-secret");
    writeFileSync(path, "not-a-secret\n", { mode: 0o600 });
    const { code, stderr } = await startExpectingFailure({ dir });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/identity secret/i);
    expect(readFileSync(path, "utf8")).toBe("not-a-secret\n");
  });

  it("refuses to start with a malformed IDENTITY_SECRET, without echoing it", async () => {
    const leaked = "zz-too-short-zz";
    const { code, stderr } = await startExpectingFailure({ env: { IDENTITY_SECRET: leaked } });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/IDENTITY_SECRET/);
    expect(stderr).not.toContain(leaked);
  });

  it("is git-ignored wherever a relative DB_PATH might put it inside the repo", () => {
    for (const path of ["identity-secret", "data/identity-secret", "src/identity-secret"]) {
      // exits non-zero (and throws) if the path is not ignored
      execFileSync("git", ["check-ignore", "-q", "--no-index", path]);
    }
  });

  it("keeps an in-memory database's secret in memory too, never in the working directory", async () => {
    const cwd = makeTempDir();
    const server = await startServer({ dbPath: ":memory:", cwd });
    expect(issuedCookie(await rawRequest(server.baseUrl, { path: "/" }))).toBeDefined();
    expect(readdirSync(cwd)).toEqual([]);
  });
});
