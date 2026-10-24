# Process overview

I worked with Claude Code in a propose → review → approve loop across Crits
8–10: the agent researched, proposed, or drafted; I corrected or rejected;
nothing was written, committed, or deployed until I'd approved it, and I
kept the running app open rather than trusting green tests alone.
`CLAUDE.md` is the harness that loop produced — four constraints derived
from README's definition of good, extended rather than replaced as the
project grew.

## Defining "good", and rejecting the first generic build

I fixed the core interaction — **write → throw → catch → read** — before
any code existed. Robin Sloan's home-cooked-app essay showed me a good app
needn't be big or popular, only meaningful to the people who use it:
technology should serve people, not chase growth or attention. So no feed
or profile. But Sloan cooks for people he knows, and this app is for
strangers, so its warmth has to come from one honest message rather than
a relationship. PostSecret
is the alternative I argued against: a curator decides what anyone sees,
where here a blind draw does. I rejected two of the agent's
definitions: "Surprising" is a blind, unmediated draw, not "you
can't catch again"; "Human" means plain text and no AI-assisted composition,
not just a character limit
([`7c96d67`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/7c96d67)).
I rejected the first `CLAUDE.md` because it froze the schema permanently
instead of separating principles from Crit 8 scope
([`98e3af1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/98e3af1)).
The stack — `node:http`, `node:sqlite`, plain HTML/CSS/JS on Node 24, zero
runtime dependencies — fits two actions and one SQLite file on Fly's single
volume without a framework or a second service. The cost is that I write
what a framework would give me: a body-size cap, a tiny Markdown renderer
for `/readme/`, and in Crit 10 cookie parsing and signing. Each stayed small
enough to read in one sitting, which matters more to me than saving lines.

The workflow trade-off is speed. Read-only audits before any edit, specs
before implementation, and an explicit approval before each commit and
deploy made every week slower than letting the agent run. They paid off in
specific places: the Crit 9 audit showed `{ empty }` was the wrong thing to
push live, and in Crit 10 a review before committing caught a README that
contradicted the code.

Specs went in failing first
([`3c9157b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/3c9157b)).
Browser inspection caught what the suite couldn't: a throw animation
silently producing `translate(NaNpx, …)` because SVG elements have no
`offsetWidth`
([`659e3d9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/659e3d9)).
A requirements audit then found that a returning visitor saw an identical
page even though bottles persisted, so `GET /api/ocean → { empty }` was added
([`0129c38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/0129c38)),
and I checked persistence on the deployed app across a redeploy
([`d5fcbbc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/d5fcbbc)).

## Anonymous activity over presence

For Crit 9 an audit of the running app showed `{ empty }` only changes on
the first and last bottle, so pushing it live would be "real-time" while
showing almost nothing. I rejected presence counts and bucketed fullness
against Small/Anonymous/Surprising and chose content-free `thrown`/`caught`
events to every session
([`4a35f52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/4a35f52);
[ADR 0001](decisions/0001-crit9-realtime-multiuser-behaviour.md)).
Failing specs came first, and running them exposed parallel spec files
racing on one server: I confirmed the cause with `--no-file-parallelism`,
then fixed the harness with `fileParallelism: false` rather than the tests
it was breaking
([`6ecee15`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/6ecee15)).
I verified the live reactions on the deployed app with two clients
([`051642e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/051642e)).
During that verification a check of mine left a stray bottle in the real
ocean, which I had to catch back out; that is why the specs now refuse any
non-loopback host, alongside a request-body cap
([`d200782`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/d200782)).
A later redesign made the decorative bottles track a capped `visualLevel`
([`ef5b270`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/ef5b270);
[ADR 0002](decisions/0002-ambient-bottle-population-visibility.md)); when a
follow-up write-up overstated that decision, I corrected the ADR's history
rather than keep the tidier story
([`78e0af3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/78e0af3)).

## Telling people apart without undoing Anonymous

Crit 10 needs the server to tell two browsers apart, check permissions, and
log who did what. My README and `CLAUDE.md` forbade exactly that — "no
cookie, no session identifier." I had the agent audit the code read-only
and name the conflict before proposing anything, then compared three
options: a client-side token (forgeable, and `EventSource` can't send
headers), per-connection identity (lost on every reload and Fly auto-stop),
and a server-issued HttpOnly cookie. I chose the cookie, then pushed the
design further: HMAC-signed rather than a bare random id, so only
server-issued identities are ever logged, with the secret persisted beside
the database on Fly's volume. Every visitor keeps identical rights — I
ruled out ownership, and a rule against catching your own bottle. The
database still has no sender or receiver column, SSE frames still carry
nothing, and logs hold a keyed pseudonym, never the message or which bottle
([ADR 0003](decisions/0003-crit10-pseudonymous-browser-identity.md)). That
is a real loss of anonymity, so README now says so instead of keeping a
claim the code no longer meets.

Tests came first: 55 new specs on their own restartable servers, 48 of
them failing against the unchanged app for the expected reasons. Two review
passes then caught what I'd missed: README and `CLAUDE.md` still
contradicted the logs, a relative `DB_PATH` could drop the secret inside
the repo, and `.dockerignore`'s bare `identity-secret` only matched the
root. One finding didn't hold — a supposed race in the SSE test helper was
already handled — so I kept the code and added a regression test instead.
Two isolated Chrome contexts then confirmed what Node clients couldn't:
real browser headers pass the origin check and `EventSource` sends the
cookie.
It landed as one commit
([`a6a4c30`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/a6a4c30)).

After a pre-commit review, CI ran 82/82 specs and deployed; read-only Fly
checks confirmed the `Secure` cookie and the 0600 secret.

At the crit, two classmates used the live URL, one in a separate Chrome
profile and one incognito, throwing and catching while I read only the
logs; nothing went wrong. One asked whether the bottles on the water were
live; I said only the first few are, by design. Without saved logs, I
repeated it on
production in two isolated Chrome profiles: two distinct actors, each
action correctly attributed, both pages rippling at the same moment. The
cost: the random catch took a real stranger's bottle, a risk I accepted.

## Making Persists a check, not a promise

Persistence was the only fixed requirement without a spec. Crit 10's
restartable test server made it testable: a `CLAUDE.md` rule plus two
specs (thrown bottles survive a restart; caught ones stay caught), which
I confirmed fail against an in-memory database
([`84c0a33`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/84c0a33)).

A last audit found no `/readme/` link, no accessibility check and two
low-contrast texts; all three are now `CLAUDE.md` rules or specs
([`2645b96`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/2645b96)).
