import { afterEach, expect, it } from "vitest";
import {
  cleanupAll,
  cookiePair,
  issuedCookie,
  rawRequest,
  startServer,
  type TestServer,
} from "./support/server-process.ts";

// Persists: what one visitor does is still there for another after the app
// stops and starts again — the marker's "come back the next day", when Fly
// has auto-stopped the machine in between. Each test spawns its own server on
// a temp directory and restarts it against the same directory (see
// spec/support/server-process.ts), never the shared APP_URL app. stop() sends
// SIGTERM, and the server installs no handler for it, so this is an abrupt
// exit rather than a graceful shutdown.

afterEach(cleanupAll);

async function newVisitor(server: TestServer): Promise<string> {
  const res = await rawRequest(server.baseUrl, { path: "/" });
  return cookiePair(issuedCookie(res)!);
}

function throwAs(server: TestServer, cookie: string, message: string) {
  return rawRequest(server.baseUrl, {
    method: "POST",
    path: "/api/bottles",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ message }),
  });
}

async function catchAs(server: TestServer, cookie: string) {
  const res = await rawRequest(server.baseUrl, {
    method: "POST",
    path: "/api/bottles/catch",
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as { bottle: { message: string } | null; message?: string };
}

async function ocean(server: TestServer) {
  return JSON.parse((await rawRequest(server.baseUrl, { path: "/api/ocean" })).body);
}

async function restart(server: TestServer): Promise<TestServer> {
  await server.stop();
  return startServer({ dir: server.dir });
}

it("a bottle thrown before a restart is caught, intact, by a different visitor after it", async () => {
  const first = await startServer();
  const message = `persists across restart ${Date.now()}`;
  expect((await throwAs(first, await newVisitor(first), message)).status).toBe(201);

  const second = await restart(first);
  expect(await ocean(second)).toEqual({ empty: false, visualLevel: 1 });
  const caught = await catchAs(second, await newVisitor(second));
  expect(caught.bottle?.message).toBe(message);
});

it("a bottle caught before a restart stays caught after it", async () => {
  const first = await startServer();
  const visitor = await newVisitor(first);
  expect((await throwAs(first, visitor, "caught once, never again")).status).toBe(201);
  expect((await catchAs(first, visitor)).bottle?.message).toBe("caught once, never again");

  const second = await restart(first);
  expect(await ocean(second)).toEqual({ empty: true, visualLevel: 0 });
  const again = await catchAs(second, await newVisitor(second));
  expect(again.bottle).toBeNull();
  expect(again.message).toBe("The ocean is quiet. No bottles to catch yet.");
});
