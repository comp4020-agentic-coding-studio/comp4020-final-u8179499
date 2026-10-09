# Process overview

I worked with Claude Code in a propose → review → approve loop across Crit 8
and Crit 9: the agent researched, proposed, or drafted; I corrected or
rejected; nothing was written or committed until I'd approved it, and I kept
the running app open the whole time rather than trusting green tests alone.
`CLAUDE.md` is the harness that loop produced — four permanent constraints
derived from README's definition of good, carried forward and extended, not
replaced, as the project grew.

## Defining "good", and rejecting the first generic build

I fixed the core interaction — **write → throw → catch → read** — and the
Crit 8 scope before any code existed: one shared ocean, anonymous senders, a
bottle caught only once, an atomic catch, no seeded bottles. I had the agent
survey the brief's "notes on good," then chose Robin Sloan's home-cooked-app
essay and PostSecret as references, PostSecret specifically as a contrast —
it has a curator, this app doesn't. I rejected two of the agent's own
definitions: "Surprising" isn't "you can't catch again," it's a blind,
unmediated draw every time; "Human" means plain text and no AI-assisted
composition, not just a character limit
([`7c96d67`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/7c96d67)).
`CLAUDE.md` turned that into constraints I rejected a draft of first, since
it tried to freeze the database schema permanently rather than separating
permanent principles from Crit-8-specific scope
([`98e3af1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/98e3af1)).
The stack — `node:http`, `node:sqlite`, plain HTML/CSS/JS on Node 24, zero
runtime dependencies — was chosen because two actions and an existence check
don't need a framework, and a single SQLite file is durable storage that
fits Fly's one mounted volume without standing up a second service.

Six behavioural specs were committed failing before any implementation
([`3c9157b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/3c9157b)).
The build that made them pass still read as a generic form when I actually
looked at it, so I redirected the visuals three times — rejecting an
abstract night-horizon pass before landing on a daytime, then moonlit,
ocean — and the harness started earning its keep here: browser inspection
caught bugs the suite couldn't, most notably a throw animation that never
ran because `offsetWidth`/`offsetHeight` are `undefined` on an SVG element,
silently producing `translate(NaNpx, …)`. A cropped screenshot exposed it; a
`getBoundingClientRect()` helper fixed it
([`659e3d9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/659e3d9)).
A later requirements audit caught a further gap the same way: bottles
persisted, but a returning visitor saw an identical page, since nothing yet
reported that the ocean held anything. Fixed by adding `GET /api/ocean →
{ empty }` and gating ambient bottles on it
([`0129c38`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/0129c38)).
I verified the brief's persistence requirement directly on the deployed app,
not just in this fix: a uniquely identifiable bottle thrown, the app
redeployed onto the same Fly `/data` volume, and Catch still returning that
exact message afterward.

## Choosing anonymous activity over presence, then fixing what hid it

For Crit 9 I had the agent audit the running app against the brief before
picking a transport. The audit mattered: our only shared state, `{ empty }`,
moves on exactly two transitions, so pushing it live would satisfy
"real-time" in a transport sense while most individual throws and catches
stayed invisible. I weighed three options against Small/Anonymous/
Surprising/Human and rejected two of them — presence counts (a new kind of
visibility README never asked for) and a bucketed fullness state (still a
count in spirit, and provably doesn't even guarantee every mutation becomes
visible) — before choosing anonymous, content-free `thrown`/`caught` events,
reaching every session including the sender's
([`4a35f52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/4a35f52);
full reasoning in
[`decisions/0001-crit9-realtime-multiuser-behaviour.md`](decisions/0001-crit9-realtime-multiuser-behaviour.md)).

Five failing specs went in against a `GET /api/events` endpoint that didn't
exist yet, alongside a sixth guard test that already passed — locking
`GET /api/ocean`'s existing shape so any future widening would be caught
automatically
([`6ecee15`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/6ecee15)).
Running the full suite surfaced a second bug first: Vitest running spec
files in parallel against one shared server made three unrelated Crit 8
tests fail intermittently. I confirmed the cause with
`--no-file-parallelism` before fixing the harness itself
(`fileParallelism: false`) rather than touching the tests it was breaking.
The server then still failed several of the new specs with a timeout
instead of a clean response — a standalone probe traced it to
`res.writeHead()` never flushing headers, so a client connecting before any
broadcast waited forever; `res.flushHeaders()` fixed it
([`8bccc14`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/8bccc14)).
I verified this against the real deployed app, not just localhost: two
independent SSE clients plus a two-tab browser pass confirmed sub-second
delivery, no leaked content in any frame, and no event on a losing
concurrent catch
([`8000c9a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/8000c9a)).

## The moonlit-ocean redesign and the capped-population amendment

Later, I went back to the deployed app purely as a *made thing* and didn't
like two things: the ocean read as generic, and the decorative bottles were
an all-or-nothing switch — zero, or exactly three, however many messages
actually existed. The first was a visual-redesign request; the second
became visible *during* that redesign, which is what made me treat it as a
separate product defect rather than folding it into the visual pass. I
authorized the smallest backend change that would fix it — a capped
`visualLevel` field, exact for 0-3, bucketed above that — and asked for a
new ADR rather than a rewrite of the Crit 9 record. Along the way I rejected
a first tint implementation after a zoomed screenshot showed a rotated
rectangular artifact, and caught a Chromium-specific rendering bug (a
`filter`+animated-`clip-path` combination producing a stray yellow
rectangle) by sampling actual animation frames, not CSS. I required a full
local acceptance pass before I'd allow a commit at all — real browser
sessions, two-client realtime checks, a server restart against the same
database file, and keyboard-only navigation and reduced-motion behaviour
checked by hand, not assumed from the CSS
([`ef5b270`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/ef5b270);
full decision in
[`decisions/0002-ambient-bottle-population-visibility.md`](decisions/0002-ambient-bottle-population-visibility.md)).
That commit was then pushed and verified against the real deployed app:
CI green, the new `/api/ocean` shape live, and a read-only production
smoke test that deliberately never threw or caught a bottle, to avoid
touching a real visitor's message.

Two more documentation passes followed. I later made a further, separate
product decision: the exact on-screen bottle count no longer had to hold on
every screen size — only the underlying `visualLevel` data did — and
relaxed it to a responsive, artistic choice
([`502683d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/502683d)).
Reviewing that write-up, I then caught it overcorrecting: it read as though
an exact on-screen count had never been the original requirement, when it
had genuinely been decided and built that way first. I fixed the ADR's
account rather than let a tidier story replace the real one
([`78e0af3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-u8179499/commit/78e0af3)).

This account will be rewritten again, not appended to, after Crit 10.
