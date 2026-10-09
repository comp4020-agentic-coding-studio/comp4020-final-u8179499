# Process overview

Crit 8 produced the first working slice of **Message in a Bottle** in four
committed milestones, with major direction reviewed between milestones:
definition of good → agent constraints → failing specs → implementation
([`7c96d67...659e3d9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/compare/7c96d67...659e3d9)),
then a visible-trace fix found by a later requirements audit.
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
- **Stack.** I chose Node with no runtime dependencies:
  - **`node:http`:** two actions and an existence check need no framework.
  - **`node:sqlite`:** durable relational state in one file on Fly's `/data`
    volume.
  - **Plain HTML/CSS/JS:** keeps the single-page interaction inspectable.

  Messages are trimmed before validation. The catch is one `UPDATE … WHERE
  id = (SELECT … caught_at IS NULL ORDER BY RANDOM() LIMIT 1) RETURNING
  message`, never select-then-update.

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
  changes. With the two invariants, `pnpm test` passed 8/8, and
  `pnpm typecheck` is clean.
- **Requirements audit:** after the docs were written, a re-read of the
  current Crit 8 spec ("find their trace still there when they come back")
  showed that bottles persisted but a returning visitor saw an identical page.
  `GET /api/ocean → { empty }` now reports existence only. Ambient bottles
  appear only while a real uncaught bottle exists, and a trace test brings
  the suite to 9/9
  ([`0129c38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/0129c38)).
- **Browser inspection:** desktop and 390px mobile screenshots after every
  pass, and a successful Throw and Catch stepped through frame by frame with
  the bottle's transform, clip and opacity logged.
- **Motion and collisions:** a 10-second watch measured horizontal travel of
  the waves and bottles, and bottle tilt. A script scrubbed each bottle's full
  drift cycle against the composer at four desktop sizes and on mobile, with
  and without a 280-character caught note: zero collisions.
- **Persistence:** verified on the deployed app. Bottles are stored in SQLite
  at `/data/bottles.db`, the volume `fly.toml` mounts, and tests use a
  throwaway `DB_PATH`. A uniquely identifiable bottle was thrown on the
  deployed Fly app, the app was redeployed onto the same persistent `/data`
  volume, and the ocean still reported non-empty afterward; Catch returned
  the exact pre-redeploy message, confirming persistence across a real Fly
  redeploy.

**In hindsight:** a single implementation commit hides the Horizon → daytime →
volumetric sequence from the record. From Crit 9 I'll commit each accepted
direction separately.

## Crit 9: realtime multi-user behaviour

Crit 9 started from the Crit 8 baseline above: bottles persist, but another
already-open browser never learns that someone else threw or caught one
without refreshing. Before writing anything, I had the agent audit the
running server, client, tests, README, and CLAUDE.md against the Crit 9
brief, rather than guessing at a transport straight away.

### Directing: the multi-user decision, before any transport

The audit surfaced the real problem: `GET /api/ocean` only ever reports
`{ empty }`, a single boolean that moves on exactly two transitions (ocean's
first bottle; ocean's last bottle caught). In a live demo where the ocean
already holds a bottle, most individual throws and catches would change
nothing that boolean reports — so simply pushing that same field instead of
polling it would satisfy "realtime" in a transport sense while failing the
actual spec line, since most mutations would stay invisible.

That reframed the task: the product decision had to come before any
transport choice. I compared three options against README's Small,
Anonymous, Surprising and Human — presence + live activity; pushing the
existing boolean as-is; and revealing a coarse/bucketed fullness state — and
rejected all three (the bucketed option twice over: it also doesn't actually
guarantee every mutation becomes visible, since consecutive mutations can
land in the same bucket). I chose **anonymous live activity, not presence**:
every successful Throw or Catch broadcasts a content-free `thrown`/`caught`
event to every open session, including the one that caused it, exposing
nothing else. This is recorded with its alternatives and trade-offs in
[`decisions/0001-crit9-realtime-multiuser-behaviour.md`](decisions/0001-crit9-realtime-multiuser-behaviour.md)
([`4a35f52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/4a35f52)).

### Grounding: red specs, a harness bug, then the server

I wrote the realtime contract as six failing specs against a `GET /api/events`
endpoint that didn't exist yet
([`6ecee15`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/6ecee15)).
Running the full suite exposed a second, unrelated problem first: two spec
files racing against the one shared running server and its one shared
database, since Vitest ran them in parallel — three Crit 8 tests failed
intermittently with no change to their own logic. I confirmed this with
`--no-file-parallelism` (all Crit 8 tests passed), then fixed the harness
itself with `fileParallelism: false` in `vitest.config.ts` rather than
touching or weakening any existing test. With that fixed, exactly the five
new realtime specs were red, each failing for the same, correct reason:
`GET /api/events` returned 404.

The server implementation
([`8bccc14`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/8bccc14))
keeps persistence and broadcast separate: an in-memory `Set` of open SSE
connections, broadcasting a bare `event: thrown`/`caught` frame only after
`throwBottle`/`catchBottle` already succeeded — Catch's existing atomic
`UPDATE … RETURNING` is untouched, so a losing concurrent catch still emits
nothing. The first pass still failed three of the five specs with a 5-second
timeout instead of turning green. A standalone `fetch()` probe against
`/api/events` reproduced a hang with no response at all, which traced to
`res.writeHead()` alone not flushing headers to the socket in Node — a
client connecting before any broadcast ever happened waited forever for
bytes that were never sent. `res.flushHeaders()` right after `writeHead()`
fixed it; all 15 specs passed after that.

### Correcting: anonymous reactions, not a feed

The client
([`8000c9a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/8000c9a))
adds one `EventSource` to `/api/events` and a brief, content-free reaction on
the existing sea element: Throw brightens it outward, Catch dims it inward,
identical for every connected browser including the one that acted, so the
reaction only ever fires from the received event, never duplicated from the
Throw/Catch POST handlers. No identity, presence count, message preview,
bottle count, or activity history is introduced anywhere. Reduced-motion
users keep the same reaction, shortened from 700ms to 350ms rather than
removed, matching the file's existing reduced-motion convention.

### Verifying

- **Specs:** red for the right reason (missing endpoint, not a syntax or
  setup error), then 15/15 green after the server fix, confirmed again after
  the client change.
- **Reduced motion:** checked with an emulated `prefers-reduced-motion:
  reduce` context — the pulse class still applies, with its CSS
  `animation-duration` measured at `0.35s` there versus `0.7s` normally.
- **Deployment:** through the existing GitHub Actions / Fly workflow only —
  pushing each commit to `main` ran the repo's own `check` then `deploy`
  jobs (no manual `flyctl deploy`), and CI's own "verify the deployed site is
  online" step passed on both the server and client pushes.
- **Deployed, multi-client verification:** against the real
  `https://comp4020-final-u8179499.fly.dev`, not localhost. Two independent
  SSE clients (raw `fetch` against `/api/events`, parsing the wire frames
  directly) plus a separate two-tab headless-browser pass confirmed: both
  clients open the stream; a Throw and a Catch each propagate to both
  already-connected clients without reconnecting; the event frames contain
  no message text, id, count, or session/user identity; an unsuccessful
  catch emits nothing; `GET /api/ocean` is still exactly `{ empty: boolean
  }`; and the two browser tabs showed the bright/dark reaction remotely with
  no reload. Every event arrived effectively instantly, well inside the
  ~1-second bar. A connection was also left open and idle for 4 seconds
  against production before throwing again, confirming Fly's proxy keeps a
  single SSE connection alive rather than silently dropping it.
- **A verification bug, not a production one:** a liveness check I wrote
  treated `ReadableStreamDefaultReader.closed` as a boolean, when it is
  actually a Promise — so the check was always false regardless of the real
  connection state. I caught this, replaced it with a real liveness probe
  (idle, then confirm the *same* connection still delivers), and confirmed
  the original failure was in my script, not in `src/server.ts` or the
  deployed app.
- **Cleanup:** that same liveness check had thrown a bottle on the real
  production app without catching it. Caught via `GET /api/ocean` reporting
  `{ "empty": false }` after verification, drained with a real
  `POST /api/bottles/catch`, and confirmed `{ "empty": true }` on the live
  app afterward.

## Post-Crit-9 Visual Redesign

Everything above this section was verified against the deployed Fly app.
**Everything in this section has so far been verified only locally**,
against an isolated throwaway database — not against
`https://comp4020-final-u8179499.fly.dev`. As of this section, nothing
described here has been committed, deployed, or redeployed; the Crit 9
production verification above is still the only production verification
this project has.

### Directing: starting from the look, then fixing what the look exposed

After Crit 9 shipped, I went back to the running app as a *made thing*,
independent of whether its tests passed, and didn't like how it looked: the
ocean scene read as generic rather than specific, and the ambient/decorative
bottles visually floated on top of the water rather than looking like they
belonged in it. This started as a broad visual redesign request — make the
moonlit ocean and its decorative bottles look more integrated and natural —
not a product-logic change. I directed the agent to investigate root causes
rather than paint over symptoms, and to verify with the real running app at
every step; I explicitly told it not to claim a visual issue was fixed
because an automated test passed.

It was only *during* that visual refinement — redesigning how the decorative
bottles sit in and relate to the water — that an existing product problem
became visible rather than just theoretical: the ambient population was an
all-or-nothing effect (zero decorative bottles, or exactly three, regardless
of whether the ocean actually held one message or fifty). Seeing that
rendered on screen, rather than reading it as a line in a spec, is what made
me treat it as a defect worth fixing in its own right, separately from the
visual redesign in progress. Only then did I make the product call: ambient
bottles should track the real uncaught-message count exactly for small
numbers (0, 1, 2, 3) and become a deliberately imprecise "busy ocean" once
the count passes 3, never an exact number beyond that. I authorized the
smallest backend change this required — a new `visualLevel` field alongside
the existing `empty` boolean — and asked for it to be written up as a new,
separate ADR for my review rather than silently rewritten into the
historical Crit 9 record. That became
[`decisions/0002-ambient-bottle-population-visibility.md`](decisions/0002-ambient-bottle-population-visibility.md),
now **Accepted** after my review.

### Grounding and correcting: defects found, and what fixed them

This pass surfaced several real visual defects, each one caught by actually
looking at the running app rather than trusting green tests, and each one
corrected before I allowed the next step:

- **A yellow rectangular artifact** flashed around the bottle during the
  Throw/Catch flight animation. Root cause: a Chromium rendering quirk where
  `filter: drop-shadow()` and an *animated* `clip-path` on the same
  transformed element produce a stray rectangular highlight instead of a
  shape-following shadow. Fixed by splitting the flying bottle into a
  wrapper element (owning the transform, opacity, and glow) and an inner
  element (owning only the clip-path), animated in parallel — confirmed
  gone by sampling rendered frames across the entire flight, not just
  checking the CSS.
- **Ambient bottles looked like they were floating above the water**, not
  in it. I rejected the first visual pass for this reason and asked
  specifically for 30-50% visible submersion with natural water occlusion
  and tinting. The first implementation of the tint (a plain rectangular
  overlay with a CSS gradient) produced a visible rotated-rectangle artifact
  when the bottle rocked — caught via a zoomed screenshot, not by the human
  eye alone at normal zoom. It was corrected by switching to an SVG-native
  `clipPath` shaped exactly like the bottle's own glass outline, which
  cannot produce a rectangular bounding artifact.
- I then found the submerged part **still too visible** on a second look
  and asked for the mask and tint to be pushed further (steeper fade,
  stronger blue-green tint) while keeping the upper bottle and cork clearly
  readable — a second, independent round of my own visual correction on top
  of the first.
- A **realtime visual discontinuity**: the client that threw a bottle could
  see its own ambient lane activate while its own multi-second flight
  animation was still playing, reading as a second bottle appearing before
  the first had landed. Fixed by deferring the *acting* client's own
  ambient-population update until its own flight animation finishes, while
  every other (bystander) client still updates immediately — re-verified
  with two independent browser sessions after every later visual change
  that touched the same markup, to make sure later work hadn't silently
  broken it.
- The multiline **textarea scrollbar looked like a default, unstyled
  browser scrollbar**. Restyled to the dark ocean aesthetic using the
  standard `scrollbar-color`/`scrollbar-width` properties with a
  `::-webkit-scrollbar-*` fallback. Verifying this exposed a tooling
  limitation, not an app bug: headless Chromium does not paint scrollbars
  into screenshots at all, confirmed with a minimal sanity test outside the
  app, so real verification required a headed browser.

### Verifying: a full local acceptance pass before anything is committed

Before allowing a commit, I required a comprehensive, verification-only
pass against the actual running app via Playwright/Chromium (not just
`pnpm check`), using an isolated local database the production volume never
touches. This covered: visual inspection at three viewports (no title
overflow, no stray artifacts, zero console errors); the full Throw/Catch
workflow including empty/whitespace rejection, the 280-character cap,
single-use bottles, and repeated cycles; the ambient population matrix
(exact 0/1/2/3, dynamic 2-4-lane "many", and the reduced-motion static
fallback); two-independent-browser-session realtime behaviour, including
confirming the SSE payload carries no data at all and that an unsuccessful
catch broadcasts nothing; persistence across both a page refresh and a full
local server-process restart against the same database file; and
keyboard-only operation (correct tab order, Enter/Space activation, visible
focus states). `pnpm check` (16/16) and `pnpm check:evidence` passed
throughout. No defect survived this pass. None of it has been run against
the deployed Fly app, and this section should not be read as claiming it
has.
