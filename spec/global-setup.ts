import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

// spec/*.test.ts drains and re-throws every bottle it finds before each
// test — safe against a disposable container, permanently destructive
// against anything real. Only loopback hosts are trusted by default; any
// other host, including this project's own Fly deployment, needs an
// explicit, deliberate opt-in.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function assertSafeTestTarget(baseUrl: string): void {
  if (process.env.ALLOW_DESTRUCTIVE_REMOTE_TESTS === "1") return;

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`APP_URL ("${baseUrl}") is not a valid URL.`);
  }

  if (LOOPBACK_HOSTNAMES.has(hostname)) return;

  throw new Error(
    `Refusing to run the test suite against "${baseUrl}". These specs drain and ` +
      `re-throw every bottle they find, which would permanently destroy real data ` +
      `on anything that isn't a disposable local instance. Point APP_URL at a ` +
      `loopback host (e.g. http://localhost:8080), or set ` +
      `ALLOW_DESTRUCTIVE_REMOTE_TESTS=1 if "${baseUrl}" is definitely safe to drain.`,
  );
}

// The spec checks a RUNNING app over HTTP, so it holds whatever the app is
// built with. CI builds the Dockerfile, starts the image and points APP_URL
// at it, so what passes there is what deploys. Locally, start your app however
// you run it, then `pnpm check`; APP_URL says where it's listening. It waits
// up to a minute, since some stacks take a while to boot or migrate.
export default async function setup(project: TestProject): Promise<void> {
  const baseUrl = process.env.APP_URL ?? "http://localhost:8080";
  assertSafeTestTarget(baseUrl);

  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(baseUrl);
      break;
    } catch {
      // not up yet
    }
    if (attempt >= 300) {
      throw new Error(
        `nothing is answering at ${baseUrl}: start your app first, or set APP_URL to where it's listening`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  project.provide("baseUrl", baseUrl);
}
