# ADR 0002: Capped visual population for the ambient ocean

- **Status:** Accepted
- **Builds on:** ADR 0001 (Crit 9 realtime multi-user behaviour) — does not
  change the realtime event contract at all. ADR 0001's `thrown`/`caught`
  SSE events remain exactly as specified there: content-free, broadcast to
  every open connection including the sender's, never replayed to a
  reconnecting client. Only the durable `GET /api/ocean` resource is
  affected, and only in the specific way described below.

## Context

Until now, `GET /api/ocean` reported only `{ empty: boolean }` — whether any
uncaught bottle exists, nothing more. The ambient ocean visualised that as a
single all-or-nothing switch: zero decorative bottles, or exactly three,
regardless of whether the real ocean held one message or fifty. The owner
found this confusing in practice — throwing a single bottle into an empty
ocean made three decorative bottles appear at once, which reads as a lie
about how many messages are actually out there.

The owner asked for the decorative population to track the real number of
uncaught messages for small counts (1, 2, 3 bottles shown exactly), and to
feel "alive" without being precise once the count passes 3.

## Decision

`GET /api/ocean` now returns a second field alongside `empty`:

```json
{ "empty": boolean, "visualLevel": 0 | 1 | 2 | 3 | "many" }
```

`visualLevel` is computed by reading at most 4 uncaught rows
(`SELECT 1 FROM bottles WHERE caught_at IS NULL LIMIT 4`) — 0 through 3 are
exact counts, and 4 or more collapses to the single bucket `"many"`. `LIMIT
4` guarantees the query never *returns* more than 4 rows and never counts
the full table to produce its answer, so the result set stays small
regardless of how large the ocean gets. It is not a guarantee of constant
query *cost*: without an index on `caught_at`, SQLite may still have to scan
past caught rows to find up to 4 uncaught ones, so actual cost depends on
table size and indexing, not on `LIMIT 4` alone.

The frontend uses this to drive how many decorative bottles are visible:

- 0 → no decorative bottles.
- 1, 2, 3 → the ocean aims to show that many decorative bottles, laid out
  across existing drift lanes.
- "many" → a randomly-varying population of 2-4 lanes that drift in and out
  over time, never settling on a number and never claiming to be exact.

**The 0-3 exactness above is a data contract on `visualLevel`, not a pixel
contract on the rendered scene.** The owner has since clarified (see
"Clarification" below) that exactly how many decorative bottles are drawn
for a given `visualLevel`, and where they're placed, is an artistic,
responsive design choice that may adapt to a screen's available space —
not a strict promise that every device renders precisely one bottle per
uncaught message.

This is **read-only, decorative metadata**. Catch is unaffected: it remains
`POST /api/bottles/catch`, a single atomic `UPDATE … RETURNING` with no
knowledge of `visualLevel` at all, and it is still impossible to select which
bottle you get. `visualLevel` is never attached to a particular bottle, id,
or message — it is a property of the ocean as a whole, read fresh on every
sync, the same way `empty` always was.

### What is still never exposed

- message text
- bottle IDs
- sender/receiver or any identity
- activity history
- an exact count once the real number reaches 4 or more

## Clarification: frontend rendering vs. API exactness

The original ask that motivated this decision (see Context above) described
wanting "1, 2, 3 bottles shown exactly." That described the goal for the
*data* — the owner has since clarified that it was never meant to lock the
*rendered scene* to a pixel-exact count on every possible screen size. Two
separate things were previously easy to conflate, and this clarifies them:

1. **The API contract** (`visualLevel` is exact for 0-3, capped at `"many"`
   for 4+) is unchanged by this clarification and remains exact. This is
   the part that must never regress.
2. **How the frontend renders that data** — how many decorative bottles
   actually appear on screen for a given `visualLevel`, and where — is an
   artistic, responsive design choice, not a second contract. It may adapt
   to the space available on a given viewport (for instance, a very narrow
   screen may not have room for the same bottle layout as a wide one). The
   requirement is that the scene aims to represent `visualLevel`
   faithfully, not that every device renders identically or that the
   bottle count can be used to re-derive the exact data value by counting
   pixels.

This does not loosen or conceal the opacity trade-off this ADR makes at the
API level (see "Costs and trade-offs" below) — it only removes an
unintended, stricter promise about rendering that was never the actual
product requirement.

## What this supersedes in ADR 0001, and what it doesn't

ADR 0001 made two separate claims, and this decision touches only one of
them:

1. **The realtime event contract** (`thrown`/`caught` SSE frames: anonymous,
   content-free, unfiltered by sender, never replayed). **Unchanged, still
   fully in force.** This ADR does not touch it.
2. **The durable state-visibility claim**: "the durable ocean state exposed
   to a client is unchanged" and `{ empty }` "stays exactly that shape."
   **This is the part this decision supersedes**, and only for the 0-3
   band: `GET /api/ocean` now also states the exact uncaught count when it
   is 0, 1, 2, or 3. `spec/realtime.test.ts`'s guard test, which previously
   enforced claim 2 in its original strict form, has been **updated, not
   deleted or weakened** — it now locks the new shape (`{ empty,
   visualLevel }`, capped at 3/`"many"`), so any *further* widening beyond
   this decision is still caught automatically. `spec/bottles.test.ts`
   gains a dedicated test walking all five transitions (0→1→2→3→many, and
   back down).

README.md's "Surprising" section previously said the ocean's visible trace
tells you "not how many" bottles are out there. With 1-3 real messages, that
is no longer quite true — the exact count is now visible by design, within
that narrow band. README's updated wording is honest about that: it says
the water shows exactly how many for a small number, states the four-or-more
threshold explicitly, and is careful to describe what the *API* reports
rather than claim the real number is unknowable to a patient outside
observer. `CLAUDE.md` has also been updated to document the current
realtime (`GET /api/events`) and `visualLevel` contracts directly, alongside
the four permanent principles, rather than leaving them undocumented there.

## Alternatives considered

### 1. Keep `{ empty }` only; infer population from timing/animation alone

Have the client guess "how alive" the ocean feels purely from how often
`thrown`/`caught` events arrive, without a durable population field.

- **Rejected**: this can't produce a stable, correct count for the owner's
  explicit 1/2/3-exact requirement — a client that joined late, or missed
  events while backgrounded, would have no way to recover the true count of
  0-3 messages, only a guess. The owner's spec requires exactness in that
  band, which requires reading it from the durable store.

### 2. Expose the exact bottle count unconditionally

Simplest possible implementation: `{ empty, count: number }`.

- **Rejected**: directly contradicts README's "not how many" framing for any
  count, and gives away exactly how much activity the whole app has ever had
  once the ocean gets large — the owner explicitly asked to keep the 4+ state
  "deliberately imprecise" and ruled out "exact counts beyond three."

### 3. A coarser bucket scheme for the whole range (e.g. "none/one/few/many")

Avoid ever being exact, even for 1-3.

- **Rejected**: fails the owner's explicit requirement that 1, 2, and 3
  uncaught messages each show as *exactly* that many decorative bottles —
  this was the specific behaviour asked for, not a stricter privacy posture
  than before.

## Costs and trade-offs

- For the first time, a client can learn the exact number of uncaught
  messages when that number is 1, 2, or 3. This is a real, intentional
  reduction in opacity versus ADR 0001/Crit 8, scoped to a small band.
- `"many"` is still a single bucket forever, no matter how large the ocean
  gets (4 and 4,000 look identical) — the imprecision the owner wanted for
  the "alive ocean" feeling is preserved above the threshold.
- The decorative population in "many" mode is randomly generated and
  intentionally does not track the real count at all beyond "4 or more" — it
  must never be read by anyone (including future maintainers) as a literal
  visualisation of how many messages exist.
- **A capped API is not a guarantee against inference.** This decision
  caps what `GET /api/ocean` states directly — it does not and cannot make
  the real activity level unknowable. Someone willing to watch the
  anonymous `thrown`/`caught` events continuously and correlate their
  timing against `visualLevel`'s own transitions could, over a long enough
  observation window, form a reasonable estimate of real activity beyond
  what `visualLevel` alone reveals, in the same way that watching any
  public, timestamped activity stream for long enough reveals more than any
  single snapshot of it does. Nothing here should be read as a claim that
  observed events plus a capped field together add up to "safe from
  inference" — only that the *API surface itself* never states more than
  the capped value.

## Status of this decision

Accepted and implemented in `src/db.ts` (`oceanVisualLevel`),
`src/server.ts` (`GET /api/ocean`), `src/html/index.html` (ambient bottle
population manager), `spec/bottles.test.ts`, and `spec/realtime.test.ts`,
alongside the corresponding wording change to README.md's "Surprising"
section. ADR 0001 itself is left entirely unedited; see "What this
supersedes in ADR 0001, and what it doesn't" above for exactly which part
of it this decision amends.
