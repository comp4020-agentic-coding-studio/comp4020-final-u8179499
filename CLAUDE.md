# Your harness

These rules come directly from README.md's definition of good
(commit 7c96d67). If README.md changes, these rules change with it —
don't let them drift apart.

## The four constraints — never violate these

- **Small**: the only two actions that exist are throw and catch — no
  accounts, no login, no follower or catch counts, no page or endpoint
  that lists or browses bottles. The decorative/ambient bottles drawn on
  the ocean (see "Ambient population" below) are a visual effect only —
  they are never a list, never individually selectable, and never a
  second way to browse what's in the ocean. A new interaction must never
  turn this into a feed, a browsing experience, or a social network, and
  must never undermine README.md's definition of good.
- **Anonymous**: visitors are anonymous to each other — no visitor can
  ever learn who threw or caught anything. No name, no account, no
  profile, no sender or receiver identity of any kind. Bottle records
  never say who: the schema is `id, message, created_at, caught_at`; no
  field may ever encode who did something. The realtime events described
  below carry no identity, session marker, or presence count either —
  only that a throw or catch happened. Server observability is a
  separate, narrower thing (since Crit 10): the pseudonymous browser
  identity below exists only in an HttpOnly cookie and in operator-only
  stdout logs, which Fly retains and which may therefore hold a
  pseudonymous record of actions. Visitors can never read those logs, and
  the identity never reaches the database, an API body, an SSE frame, or
  the page.
- **Surprising**: catch never accepts a filter, search, or preview
  parameter, and never returns more than one bottle. Claiming a bottle
  must be atomic (a single `UPDATE ... WHERE caught_at IS NULL`, never
  select-then-update) so two simultaneous catches can't return the same
  bottle. The ambient population indicator (`visualLevel`, below) is
  read-only decorative metadata about the ocean as a whole — it is never
  attached to a specific bottle and never lets anyone choose or preview
  one before catching.
- **Human**: messages are plain text only, capped at 280 characters.
  Never add formatting, attachments, hashtags, or AI-assisted
  composition of the message itself.

## Current realtime contract (since Crit 9)

- `GET /api/events` is a Server-Sent Events stream. Every *successful*
  Throw or Catch broadcasts a `thrown` or `caught` frame to every
  currently open connection, including the one that triggered it. The
  frame carries **no payload** — no message text, no bottle id, no
  count, no identity, just the fact that one of the two actions
  happened.
- A Catch that fails to claim a bottle (ocean already empty, or it lost
  a race to another concurrent catch) broadcasts nothing. There is
  exactly one `caught` event per bottle, ever.
- The atomic Catch invariant from Crit 8 is unchanged and must stay that
  way: a single `UPDATE bottles SET caught_at = ... WHERE id = (SELECT
  id FROM bottles WHERE caught_at IS NULL ORDER BY RANDOM() LIMIT 1)
  RETURNING message`, never select-then-update.
- A reconnecting or late client never gets missed events replayed — it
  only resynchronises against the current durable state from
  `GET /api/ocean`. Full rationale:
  `decisions/0001-crit9-realtime-multiuser-behaviour.md`.

## Current `/api/ocean` contract and ambient population

- `GET /api/ocean` returns `{ empty: boolean, visualLevel: 0 | 1 | 2 | 3 | "many" }`.
  `visualLevel` is the exact count of uncaught bottles for 0-3, and the
  single bucket `"many"` for 4 or more. It is computed from a
  bounded-cost query (`LIMIT 4`) and never states an exact count once
  real activity reaches 4 or more. **This exactness is an API/data
  contract and must stay exact** — never widen `"many"` into a count,
  never collapse 0-3 into a bucket.
- How the frontend renders `visualLevel` is a separate, responsive design
  choice, not a second contract: it aims to show that many decorative
  bottles when there's `0`, `1`, `2`, or `3`, but the exact number drawn
  and where they sit on screen may adapt to viewport size and available
  space. Don't read "the ocean shows exactly N decorative bottles on
  every screen" as a requirement to enforce — the requirement is that
  `visualLevel` itself, the data, is exact for 0-3.
- The frontend's decorative/ambient bottles are **a responsive visual
  representation of ocean activity, not database rows and not a precise
  visual counter**. There is no mapping from a specific decorative bottle
  on screen to a specific row in `bottles`, and a person can never click,
  pick, or preview one — Catch remains the only way to get a message, and
  it remains a blind random draw regardless of what the ambient scene
  shows.
- In `"many"` mode the decorative population is a randomly-varying count
  (2-4 lanes) that deliberately does not track the real number beyond
  "4 or more". Never build a feature as if it were a literal, precise
  visualisation of how many messages exist.
- Full rationale and trade-offs, including why this is a narrow,
  accepted loosening of the stricter Crit 8/ADR 0001 opacity stance:
  `decisions/0002-ambient-bottle-population-visibility.md`.

## Browser identity, permissions and logs (since Crit 10)

- Every browser gets one signed, random, pseudonymous identity in the
  `mib_visitor` cookie (`v1.<id>.<mac>`, HMAC-SHA256, HttpOnly,
  SameSite=Lax, 30 days, Secure on Fly). It is issued automatically to
  any request that lacks a genuine one; a missing cookie never makes an
  otherwise valid request fail. An unsigned, tampered, or foreign-key
  value is never treated as an identity.
- An identity grants nothing. Every visitor has the same rights: read
  `/`, `/readme/`, `/api/ocean`, `/api/events`; Throw; Catch (including
  their own bottle — never add a rule against that). Never add
  ownership, per-bottle permissions, accounts, profiles, or any route
  that shows a visitor who anyone is.
- Throw and Catch are refused (403, nothing changed, nothing broadcast,
  no identity issued) when a browser marks them cross-site. This is
  forgery protection, not authentication. Never add a Content-Type
  requirement that breaks existing clients.
- Logs are one JSON object per stdout line with only `ts`, `evt`,
  `actor`, `outcome`, `status`, `reason`, `cause`, `port`, `secret`.
  `actor` is a keyed-hash label (`b-` + 16 hex), never the cookie. Never
  log message text or length, bottle ids, cookie values, signatures,
  secrets, IPs, forwarded headers, User-Agents, request bodies or
  headers, or raw error objects. Never expose logs over HTTP.
- The HMAC secret lives beside the database (`identity-secret`, 0600)
  or in `IDENTITY_SECRET`; never commit it, never silently replace an
  unreadable one. Tests that need a server's stdout or a restart spawn
  their own on a temp directory (`spec/support/server-process.ts`),
  never the shared `APP_URL` app and never production.
- Full rationale, alternatives and trade-offs:
  `decisions/0003-crit10-pseudonymous-browser-identity.md`, which
  partially supersedes the "no session identity" stance in ADR 0001.

## Historical scope note (Crit 8)

Crit 8 shipped with no multi-user/real-time features and no visible
population signal beyond `{ empty }`. **That restriction is superseded**
by the Crit 9 realtime contract and the `visualLevel` decision documented
above — it no longer applies, and should not be reintroduced by mistake.
What still applies unchanged from Crit 8: no seeding of fake bottles, and
an empty-ocean catch returns a clear message ("The ocean is quiet. No
bottles to catch yet.") rather than a crash or a silent empty 200. Don't
add likes, comments, profiles, or any feature not named in README.md,
even if it would be quick to build.

## When something's wrong

- A failing check gets fixed by changing the app's behaviour or the
  README's claim — never by loosening the test until it's green.
- If you're about to add anything not covered by this file or
  README.md, stop and ask rather than build it.
