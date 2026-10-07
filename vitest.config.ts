import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // Every spec file is an integration test against the one running app and
    // its one shared database — there's no per-file isolation, so two spec
    // files draining/throwing/catching at the same time race on the same
    // ocean. Serialise file execution rather than relying on everyone
    // remembering `--no-file-parallelism` on the command line.
    fileParallelism: false,
  },
});
