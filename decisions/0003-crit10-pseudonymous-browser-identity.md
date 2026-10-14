# ADR 0003: Pseudonymous browser identity, permissions and logs for Crit 10

Status: accepted for Crit 10. Partially supersedes ADR 0001's "we
deliberately do not introduce session identity" and the README/CLAUDE.md
promise of "no cookie, no session identifier".

## Context

Until Crit 10 the Anonymous promise was absolute: the app stored nothing
about who you are — no account, no name, no cookie, no session identifier —
and "simply never learns who threw or caught anything". A bottle is
`id, message, created_at, caught_at`, with no sender or receiver column.

Crit 10 ("Fly by instruments") and the final-project brief require that
the app **tells people apart**, that **what each person may see and change
is checked on the server**, and that the server **logs who did what** so
the operator can narrate two classmates' actions from `flyctl logs` alone.
Logging "browser X threw, browser Y caught" is deriving something that links
an action to a browser, which the old rule forbade outright. That can't be
satisfied by quietly bending the rule; it needs an explicit, narrow
exception.

## Decision

### Identity

- On any request to `/`, `/readme/`, `/api/ocean`, `/api/events`, or a
  same-origin Throw/Catch that lacks a genuine identity, the server issues
  `mib_visitor=v1.<id>.<mac>`:
  - `id`: 128 random bits (`crypto.randomBytes(16)`), base64url.
  - `mac`: HMAC-SHA256 over a domain-separated string
    (`mib_visitor/v1/mac:<id>`), base64url.
  - Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
    (30 days), plus `Secure` when `FLY_APP_NAME` is set.
- A cookie is accepted only if it matches the exact shape and its MAC
  verifies with `timingSafeEqual` (after the regex has fixed both lengths).
  Unsigned ids, wrong versions, tampered MACs, ids swapped under another
  MAC, and values signed with a different key are all "invalid" and get a
  fresh identity. If several `mib_visitor` values arrive, the first genuine
  one wins.
- No cookie is issued on 404s (scanners would otherwise mint identities) or
  on refused cross-site writes.
- For `/api/events`, the cookie is set before `writeHead`/`flushHeaders`,
  so a first-time visitor whose very first request is the stream still gets
  one in the stream's response headers.

### Why `Secure` keys off `FLY_APP_NAME`

`X-Forwarded-Proto` is a request header: anything can send it locally.
`FLY_APP_NAME` is set by Fly's runtime (Fly docs, "Machine runtime
environment") and `fly.toml` has `force_https = true`, so on Fly the app is
only ever reached over HTTPS. Locally and in CI's `docker run` it is unset,
so the cookie works over plain `http://localhost`.

### Secret and lifecycle

- 256-bit key. `IDENTITY_SECRET` (64 hex chars) overrides; otherwise
  `identity-secret` beside the database, created once with exclusive
  create (`wx`) and mode 0600. With `DB_PATH=:memory:` the key is in memory
  only, so a throwaway run never writes a secret into the working directory.
  `identity-secret` is in `.gitignore` and `.dockerignore`, so a relative
  `DB_PATH` that lands it inside the repo can't commit it or ship it to a
  remote build.
- An existing but unusable secret (wrong format, unreadable) stops the
  server with an error that names the problem but not the value. It is
  never silently replaced, because that would invalidate every cookie and
  re-label every browser without anyone noticing.
- On Fly the file sits on the `/data` volume next to `bottles.db`, so it
  survives auto-stop, restart and redeploy exactly as long as the bottles
  do. Anyone who can read it can already read every message, so co-locating
  it adds no exposure. If the volume is lost, every browser simply becomes
  new; no data depends on the key.
- An identity ends when the cookie expires (30 days), when the visitor
  clears cookies, or in a private window/new profile. That's a limitation
  and a feature: someone can always choose to become a stranger again.

### Permissions (enforced on the server)

| Action | Who | Enforcement |
| --- | --- | --- |
| Read `/`, `/readme/`, `/api/ocean`, `/api/events` | anyone | public; no CORS grant |
| Throw | any visitor, same-origin | origin check; 1-280 chars; 2048-byte body |
| Catch | any visitor, same-origin, **including their own bottle** | origin check; atomic random claim |
| Read a message | only the one Catch that claimed it | text appears only in that response |
| Edit, delete, recall a bottle | nobody | no route exists |
| See who did what | no visitor; only the operator | stdout logs, no HTTP route |

Every visitor has identical rights. The identity is for telling people
apart in the logs, not for granting anything: there are no accounts, no
ownership, no per-bottle permissions. A bottle belongs to no one once
thrown, and nobody can change what someone else did, because nothing can
be changed at all — only claimed once.

The origin check refuses a Throw/Catch (403, before the body is read,
before any identity is issued, nothing broadcast) when
`Sec-Fetch-Site` is `cross-site`/`same-site`, or when `Origin` is present
and its normalised origin isn't the app's own. On Fly "the app's own" is
`https://$FLY_APP_NAME.fly.dev`, fixed at start, so a forged `Host` can't
redefine it; locally it's `http://<Host>`. A request with neither header
passes: browsers always mark cross-site requests, so that's a non-browser
client — curl, the spec — which is just one more anonymous visitor. This
is protection against another site making your browser act; it is not
authentication, and isn't meant to be. No Content-Type rule was added,
because the API has never required one.

### Logs

One JSON object per stdout line: `ts`, `evt`, and as applicable `actor`,
`outcome`, `status`, `reason`, `cause`, `port`, `secret` (the secret's
*source*: `env`/`file`/`memory`).

| `evt` | Fields |
| --- | --- |
| `server.start` | `port`, `secret` |
| `identity.issued` | `actor`, `cause`: `missing`/`invalid` |
| `sse.open` / `sse.close` | `actor` |
| `throw` | `actor`, `outcome`: `ok`/`rejected`, `status`, `reason`: `invalid_message`/`too_long`/`invalid_json`/`too_large`/`bad_origin` |
| `catch` | `actor`, `outcome`: `ok`/`empty`/`rejected`, `status`, `reason`: `bad_origin` |

`actor` is `b-` + the first 16 hex of a second, domain-separated HMAC
(`mib_visitor/v1/label:<id>`): stable for a browser across restarts while
the key is unchanged, but no way back to the cookie. A refused cross-site
request carries `actor` only if it brought a genuine cookie. `catch empty`
covers both a quiet ocean and losing a race, because the atomic UPDATE
can't distinguish them.

Never logged: message text or length, bottle ids, cookie values,
signatures, the secret, IPs or forwarded-IP headers, User-Agents, request
headers or bodies, error objects. There is no log endpoint, and the UI
never shows a label.

## What stays anonymous

To every other visitor, exactly as before: the page, `/api/ocean`, and SSE
frames (still `event: thrown|caught` with an empty `data:`) carry nothing
about anyone. The database still has no sender or receiver column — the
point of keeping the identity out of it is that nothing durable can ever
join "who threw" to "who caught" to "what it said". The logs record that
`b-1…` threw and `b-2…` caught, but not *which bottle*, so even the
operator can't pair a thrower with a reader beyond what timing implies.

What changed: the app now *can* tell browsers apart, and the operator can
see a pseudonymous history of actions in Fly's log retention. The README's
old "the app simply never learns who" is no longer true; its Anonymous
section now describes this trade-off instead.

## Alternatives considered

1. **Anonymous token in localStorage, sent as a header.** Client-chosen, so
   forgeable as any value; readable by page script; and `EventSource` can't
   set headers, so the stream would need it in the URL. Rejected.
2. **Ephemeral per-connection identity.** Changes on every reload and every
   Fly auto-stop, and can't tie a POST to a stream without the client
   echoing an id back — which collapses into option 1. Fails "logs who did
   what". Rejected.
3. **Unsigned random id in an HttpOnly cookie.** Simpler (no key, no file),
   and impersonating a specific browser would still mean guessing 128
   bits. Rejected in favour of signing so that only server-issued ids are
   ever logged as identities, forged or corrupted values are visible as
   `cause: "invalid"`, and labels can't be computed from an id without the
   key. Cost: a persisted secret and its failure mode.
4. **Accounts or chosen pseudonyms.** Against Small and Anonymous;
   nothing in the app needs them. Rejected.

## Costs and limitations

- A visitor who clears cookies, uses another profile, or goes incognito is
  a new person. Nothing prevents one human holding several identities; the
  app has nothing to protect that would make that matter.
- Two people sharing one browser profile are one identity.
- Fly's log retention now holds a pseudonymous activity history. Timing
  between a `throw ok` and a `catch ok` can hint at who caught whose bottle
  when the ocean holds one bottle.
- Losing the secret re-labels everyone; an unusable secret file stops the
  server and needs a human.
- The origin check trusts that browsers set `Origin`/`Sec-Fetch-Site`;
  very old browsers that send neither on a cross-site POST would pass, and
  SameSite=Lax still keeps their cookie off it.
