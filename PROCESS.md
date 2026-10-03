# Process overview

Crit 8 produced the first working slice of **Message in a Bottle** in four
committed milestones, with major direction reviewed between milestones:
definition of good → agent constraints → failing specs → implementation
([`7c96d67...659e3d9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/compare/7c96d67...659e3d9)).
I worked with Claude Code in a propose → review → approve loop: the agent
researched or proposed, I corrected, and nothing was written or committed
until I approved it.

## Directing: what the app is, and what "good" means

I fixed the core interaction before any code existed: **write → throw →
catch → read**, with throw and catch instead of post and browse. I also
locked the Crit 8 scope: one shared ocean, anonymous senders, a bottle can
be caught only once but its record stays (`caught_at` set), no seeded
bottles, and an atomic catch.

I had the agent survey the brief's "notes on good", then chose Robin Sloan's
home-cooked app and PostSecret, the second as a contrast: PostSecret is
curated, and a catch here is a blind draw. I corrected two of the agent's
definitions:

- **Surprising** is not "you can't catch again". Each catch returns exactly
  one random uncaught bottle with no preview or choice.
- **Human** means plain text, 280 characters, and no AI-assisted composition
  provided by the app.

The result is the README
([`7c96d67`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/7c96d67)).

## Grounding: turning the definition into constraints and contracts

- **Harness.** CLAUDE.md derives its rules from the README's four qualities
  ([`98e3af1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/98e3af1)).
  I rejected a draft that froze the schema permanently. The committed version
  separates permanent principles (never store identity; never become a feed)
  from the Crit 8 scope.
- **Starter invariants.** Before any design decisions, the agent mapped what
  the course fixes: `answers at /`, README published at `/readme/`, and Fly's
  single `/data` volume as the only durable storage.
- **Behavioural spec, red first.** I fixed the API contract (`POST
  /api/bottles` → 201/400; `POST /api/bottles/catch` → one bottle, or
  `{ bottle: null, message }` for an empty ocean). Test state is isolated so
  random selection can't make tests flaky. Six tests, including a
  concurrent-catch test, were committed failing while both invariants still
  passed
  ([`3c9157b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/3c9157b)).
- **Stack.** I chose Node, `node:http`, `node:sqlite` (no runtime
  dependencies) and plain HTML/CSS/JS, and required messages to be trimmed
  before validation. The catch is one `UPDATE … WHERE id = (SELECT …
  caught_at IS NULL ORDER BY RANDOM() LIMIT 1) RETURNING message`, never
  select-then-update.

## Correcting: from a working form to an interaction that means something

The first implementation passed its tests, but screenshots of the running app
showed a generic form. I redirected the visuals rather than polishing buttons.
These iterations were reviewed in the session but not committed separately;
they are folded into
[`659e3d9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/659e3d9):

1. **Horizon at night.** A dark horizon with a line-art bottle, a throw arc
   and a drift-in catch. I rejected it after review because it read as
   abstract, not as an ocean.
2. **Daytime ocean.** Three passes: a secondary, not harsh, sun; waves moving
   sideways instead of "three layers breathing vertically"; larger bottles
   that actually drift.
3. **Volumetric waves and half-submerged bottles.** I described a target image
   precisely: filled wave masses, not contour lines, and bottles at 35–50°
   whose lower half is hidden behind a wave in front, not faded. A final
   polish reorganised the composer and typography.

Browser checks caught bugs the tests and typecheck couldn't:

- **Throw arc never ran.** `offsetWidth` and `offsetHeight` are `undefined` on
  an SVG element, so every transform was `translate(NaNpx, …)`. The browser
  silently discarded it and the bottle sat at the corner. A pixel crop of a
  screenshot exposed it; a `getBoundingClientRect()`-based helper fixed it.
- **Thrown bottle vanished after landing.** The float keyframes never set
  opacity, so each new animation fell back to the CSS default `opacity: 0`.
- **Bottles collided with the interface.** A caught note pushes the composer
  up, and on mobile the waves were squeezed into spikes. Bottles now sink
  while crossing the composer column, and the wave layers keep a minimum
  width.

## Verifying

- **Specs before implementation:** 6/6 failing, then green with no test
  changes. With the two invariants, `pnpm test` passes 8/8, and
  `pnpm typecheck` is clean.
- **Browser inspection:** desktop and 390px mobile screenshots after every
  pass, and a successful Throw and Catch stepped through frame by frame with
  the bottle's transform, clip and opacity logged.
- **Motion and collisions:** a 10-second watch measured horizontal travel of
  the waves and bottles, and bottle tilt. A script scrubbed each bottle's full
  drift cycle against the composer at four desktop sizes and on mobile, with
  and without a 280-character caught note: zero collisions.
- **Persistence:** designed for, not yet verified. Bottles are stored in SQLite
  at `/data/bottles.db`, the volume `fly.toml` mounts, and tests use a
  throwaway `DB_PATH`. Nothing is deployed yet, so persistence across a
  deploy or redeploy has not been checked.

**In hindsight:** a single implementation commit hides the Horizon → daytime →
volumetric sequence from the record. From Crit 9 I'll commit each accepted
direction separately.
