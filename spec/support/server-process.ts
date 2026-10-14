import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Crit 10's identity and logging checks need two things the shared APP_URL
// app can't give them: the server's stdout (where the logs go) and the
// ability to stop and restart it against the same data. So these specs spawn
// their own disposable server — fresh temp directory for the database and the
// identity secret, a free loopback port, and an environment built from
// scratch so a FLY_APP_NAME or IDENTITY_SECRET in the developer's shell can
// never leak in. Nothing here can reach a deployed app or its volume.

const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "../../src/server.ts");

export type LogLine = Record<string, unknown>;

export interface StartOptions {
  // Reuse a directory from an earlier server to simulate a restart.
  dir?: string;
  // Override DB_PATH entirely (e.g. ":memory:"); defaults to <dir>/bottles.db.
  dbPath?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TestServer {
  baseUrl: string;
  port: number;
  dir: string;
  stdout(): string;
  stderr(): string;
  logs(): LogLine[];
  // Resolves with every matching line once at least `count` have appeared —
  // event-driven off stdout, never a fixed sleep.
  waitForLogs(predicate: (line: LogLine) => boolean, count?: number, timeoutMs?: number): Promise<LogLine[]>;
  stop(): Promise<void>;
}

const running = new Set<TestServer>();
const tempDirs = new Set<string>();

export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mib-spec-"));
  tempDirs.add(dir);
  return dir;
}

// Call from afterEach: stops every server and removes every temp directory
// this file created, whether or not the test passed.
export async function cleanupAll(): Promise<void> {
  await Promise.all([...running].map((s) => s.stop()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function parseLines(raw: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a non-JSON line is still in stdout() for privacy assertions
    }
  }
  return out;
}

export async function startServer(options: StartOptions = {}): Promise<TestServer> {
  const dir = options.dir ?? makeTempDir();
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: options.cwd ?? dir,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      DB_PATH: options.dbPath ?? join(dir, "bottles.db"),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const waiters = new Set<() => void>();
  const notify = (): void => {
    for (const w of waiters) w();
  };
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    notify();
  });
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => {
    notify();
    resolve(code);
  }));

  // Ready once the server has printed its first line (it prints at listen),
  // driven by stdout events rather than a fixed sleep.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`server did not start within 10s\nstderr:\n${stderr}`));
    }, 10_000);
    const check = (): void => {
      if (child.exitCode !== null) {
        clearTimeout(timer);
        waiters.delete(check);
        reject(new Error(`server exited with ${child.exitCode} before listening\nstderr:\n${stderr}`));
      } else if (stdout.includes("\n")) {
        clearTimeout(timer);
        waiters.delete(check);
        resolve();
      }
    };
    waiters.add(check);
    check();
  });

  const server: TestServer = {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    dir,
    stdout: () => stdout,
    stderr: () => stderr,
    logs: () => parseLines(stdout),
    waitForLogs(predicate, count = 1, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`fewer than ${count} matching log lines within ${timeoutMs}ms; stdout was:\n${stdout}`));
        }, timeoutMs);
        const check = (): void => {
          const hits = parseLines(stdout).filter(predicate);
          if (hits.length >= count) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve(hits);
          }
        };
        waiters.add(check);
        check();
      });
    },
    async stop() {
      running.delete(server);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
  running.add(server);
  return server;
}

// Spawns a server expected to refuse to start, and reports how it exited.
export async function startExpectingFailure(options: StartOptions): Promise<{ code: number | null; stderr: string }> {
  const dir = options.dir ?? makeTempDir();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: options.cwd ?? dir,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(await freePort()),
      DB_PATH: options.dbPath ?? join(dir, "bottles.db"),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", (c: string) => (stderr += c));
  child.stdout!.resume();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// node:http rather than fetch, because these specs need to send headers a
// fetch client refuses to forge (Host) and read every Set-Cookie verbatim.
export function rawRequest(
  baseUrl: string,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  const url = new URL(options.path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

// Returns the raw `mib_visitor=…` Set-Cookie line, if this response issued one.
export function issuedCookie(res: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const raw = res.headers["set-cookie"];
  const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return lines.find((l) => l.startsWith("mib_visitor="));
}

// The `name=value` pair to send back in a Cookie header.
export function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

export function cookieValue(setCookie: string): string {
  return cookiePair(setCookie).slice("mib_visitor=".length);
}

export interface EventStream {
  status: number;
  headers: RawResponse["headers"];
  frames(): string[];
  waitForFrames(count: number, timeoutMs?: number): Promise<string[]>;
  close(): void;
}

// Opens /api/events and resolves once response headers arrive — the moment a
// browser's EventSource would already hold any cookie the server set — and
// keeps the stream open, collecting complete SSE frames as they arrive.
export function openEvents(baseUrl: string, headers: Record<string, string> = {}): Promise<EventStream> {
  const url = new URL("/api/events", baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "GET", headers },
      (res) => {
        let buffer = "";
        const frames: string[] = [];
        const waiters = new Set<() => void>();
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let end = buffer.indexOf("\n\n");
          while (end !== -1) {
            frames.push(buffer.slice(0, end + 2));
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf("\n\n");
          }
          for (const w of waiters) w();
        });
        res.on("error", () => {});
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          frames: () => [...frames],
          waitForFrames(count, timeoutMs = 3000) {
            return new Promise((done, fail) => {
              const timer = setTimeout(() => {
                waiters.delete(check);
                fail(new Error(`expected ${count} SSE frames within ${timeoutMs}ms, got ${frames.length}`));
              }, timeoutMs);
              const check = (): void => {
                if (frames.length >= count) {
                  clearTimeout(timer);
                  waiters.delete(check);
                  done([...frames]);
                }
              };
              waiters.add(check);
              check();
            });
          },
          close: () => req.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
