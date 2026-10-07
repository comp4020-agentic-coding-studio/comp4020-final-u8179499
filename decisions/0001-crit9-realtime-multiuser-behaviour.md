# ADR 0001: Real-time multi-user behaviour for Crit 9

- **Status:** Accepted
- **Crit:** 09 — "All at once"
- **Riffs on:** Crit 8 ("It's alive!")

## Context

Crit 9 requires the final project to become real-time: a change one person
makes must reach every other open session within about a second, without a
reload, and the project must make one explicit, README-grounded decision
about how it behaves when several people use it at once.

Crit 8 left the app with exactly one piece of shared, durable state exposed
to clients: `GET /api/ocean → { empty: boolean }`. The client only reads
that endpoint once on page load and once again after its *own* throw or
catch — another already-open tab never learns that someone else acted.

The boolean is also too coarse to use as-is for real-time: it only changes
on the two edge transitions (ocean's first bottle; ocean's last bottle
caught). In any live multi-device demo where the ocean already holds a
bottle, most individual throws and catches would change nothing the
boolean reports, so naively pushing that same field would satisfy "real-time"
in a transport sense while failing to make most actual actions visible.

## Decision

**Anonymous live activity, not presence.**

Every *successful* Throw and every *successful* Catch produces an
ephemeral, anonymous real-time event, visible to every currently open
session, that communicates only the action type:

- `thrown`
- `caught`

The event must **not** expose:

- message text
- bottle IDs
- exact or approximate bottle counts
- user identity
- session identity
- presence count (how many sessions are open)
- activity history

Concurrent-catch semantics are unchanged: only a Catch that actually
succeeds through the existing atomic `UPDATE … RETURNING` in
`catchBottle()` may emit a `caught` event. A losing concurrent catch (the
ocean was already empty, or another request won the row first) emits
nothing — there is exactly one `caught` event per bottle, ever, matching
the existing "exactly one winner" guarantee.

When another open client receives an event, the eventual implementation
will:

1. play a brief visual reaction in the existing ocean scene, so the remote
   action is perceptible without reading as data; and
2. re-fetch `GET /api/ocean` to resynchronise the existing empty/non-empty
   visual state, so that state stays correct even across a dropped or
   missed event.

The activity stream itself is ephemeral and is never persisted. If a
client disconnects or opens later, missed activity is **not** replayed or
backfilled — it only resynchronises against the current durable ocean
state (point 2 above). Bottles persist; activity history does not.

### Implementation boundary: no duplicate feedback for the sender

The broadcast is not filtered by sender: every successful Throw/Catch
event reaches every currently connected client, including the one that
triggered it. We deliberately do not introduce session identity just to
suppress the sender's own event. To avoid duplicated feedback:

- the shared ocean reaction (point 1 above) is driven only by the
  *received* realtime event — the client must not also play it locally
  right after its own POST resolves;
- the POST response still drives its own local result — clearing the
  composer after Throw, showing the caught message after Catch — which is
  distinct from the shared ripple, not a duplicate of it;
- events carry no ID and are never queued for replay; a reconnecting
  client resynchronises only against current `/api/ocean` state (point 2
  above), never against missed activity.

Transport (SSE vs. WebSockets vs. polling) is an implementation detail of
this decision, not the decision itself, and is deferred to implementation.

## Alternatives considered

### 1. Presence count + live activity

Add a second, genuinely new fact — how many sessions currently have the
page open — broadcast alongside throw/caught events.

- Directly answers the brief's own example angle ("is presence visible"),
  and would make the live four-device demo feel the richest.
- **Rejected** because it is a new kind of visibility README never asked
  for: not an identity and not a follower/catch count, but still a number
  about *who else is here*, in an app whose whole premise is that nothing
  is kept or shown about who is using it. It pulls directly against Small
  ("nothing to browse in between, because there's nothing here designed to
  hold your attention") and sits uncomfortably close to the follower/catch
  counts README explicitly rules out by name. This is the strongest
  rejected alternative and the one worth arguing for at the crit.

### 2. State-only synchronisation (push the existing boolean)

Keep `{ empty }` as the only signal, just push it instead of polling it.

- Simplest possible change; adds no new concept at all.
- **Rejected** because it does not solve the actual problem described in
  Context: the boolean only moves on two edge transitions, so in any
  demo where the ocean is already non-empty, most throws and most catches
  would produce no visible change on other sessions at all, failing the
  spec's "a change… reaches everyone… within about a second" bar for
  individual actions, not just edge states.

### 3. Revealing coarse/bucketed ocean fullness

Replace the boolean with a small ordinal state ("quiet" / "a bottle or
two" / "plenty"), recomputed and pushed on every mutation.

- Would read as more visually "alive" than a bare boolean.
- **Rejected** for two independent reasons. First, README is explicit in
  prose, not just in the API shape: *"That's all it tells you: not how
  many, not whose, not what they say."* A bucketed state is a count in
  spirit even though it is never an exact number, and defending it would
  mean quietly loosening README's own definition of Surprising rather than
  building inside it. Second — and this was missed in the original
  audit — bucketing does **not** actually guarantee every mutation becomes
  visible either: several throws or catches in a row can land inside the
  same bucket (e.g. "plenty" before and after a catch that still leaves
  many bottles), so this option can silently drop the same class of
  invisible mutation it was meant to fix, just at a coarser threshold
  instead of a boolean one.

## Grounding in README's definition of good

- **Small.** No new UI control and no new concept to learn: the ocean
  reacts the way it already visually can (drift/ripple), it just reacts to
  everyone's actions now, not only your own. Nothing is added to browse.
- **Anonymous.** The event carries no identity, no session marker, and no
  presence count — strictly less information than even Option 1. It adds a
  *when*, never a *who* or a *how many*.
- **Surprising.** The durable ocean state exposed to a client is unchanged
  (`{ empty }`, resynchronised on every event) and Catch remains a blind,
  unmediated draw. The live events add perceptibility of *that something
  happened*, never advance knowledge of *what* or *how much* — nothing
  about this decision lets anyone infer the ocean's contents ahead of a
  catch.
- **Human.** A brief, anonymous reaction when someone else throws or
  catches is what makes the ocean feel inhabited by real people doing real
  things right now, rather than a static scene — without turning any of
  those people into a profile, a count, or a metric. It is the same
  distinction README already draws against PostSecret's curated feed: a
  pulse of life, never a ledger of who did what.

## Costs and trade-offs

- Users cannot see how many people are present, even though several may be
  using the app at once — the live demo proves it's real-time, not that
  it's busy.
- Simultaneous events from different sessions may be visually
  indistinguishable from each other, which is a direct consequence of
  Anonymous (no attribution is possible or intended) but means the
  "aliveness" signal is coarser than it could be.
- A client that is disconnected, backgrounded, or not yet open when an
  event fires simply misses it — there is no backlog, queue, or replay,
  by design; only the durable ocean state (empty/non-empty) is guaranteed
  to resynchronise.
- Holding a long-lived real-time connection open per client may keep the
  Fly machine out of its idle state for as long as any tab is open,
  affecting the `auto_stop_machines` / `min_machines_running = 0`
  scale-to-zero behaviour that `fly.toml` relies on to keep cost near
  zero between uses.
- The broadcast registry is in-memory, held by a single process. This
  decision and its implementation assume the current single-machine Fly
  deployment; horizontal scaling to more than one machine would require a
  shared pub/sub mechanism between instances, which is out of scope here
  and not something this ADR attempts to solve.

## Status of this decision

This ADR records the product decision only. No real-time transport
(SSE/WebSockets/polling) has been implemented yet; `src/`, the test specs,
`README.md`, `PROCESS.md`, `CLAUDE.md`, and `reflections/` are unchanged as
of this ADR.
