# Message in a Bottle

Write a message, throw it into the ocean, and it's gone from you. Someone else
catches a random bottle and reads it. That's the whole app: **write → throw →
catch → read**. A bottle stays in the ocean, across restarts and
redeploys, until someone catches it; then it's gone for good
(`spec/persistence.test.ts`).

## What "good" means here

This is for someone who wants to leave a trace, or stumble on a stranger's,
without a social app's usual apparatus — no profile, no audience, nothing to
check back on. It's good if it feels like one honest, anonymous exchange,
not a feed you could get stuck in.

Two things shaped that. Robin Sloan's
[*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/) —
his contrast between an app built for people you know and one built to scale
is the whole design brief here; a home-cooked app doesn't need a growth
strategy, so it doesn't need the things that come with one. And
[PostSecret](https://en.wikipedia.org/wiki/PostSecret), the closest real
precedent for "a stranger sends something anonymous and another person just
encounters it" — except PostSecret has a curator: Frank Warren reads
everything and chooses what gets shown. I rejected that model — a selecting
hand makes the experience about the curator's judgement, not the stranger's
message. Catching here is a blind, unmediated draw instead — the main way
this app isn't just a smaller PostSecret, and where "Surprising" below comes
from.

## Small

No accounts, no login, no follower or catch counts, no list of bottles to
scroll through — not even for the person who threw one. A feed or profile
page would be the easy addition, and the wrong one: it turns a private
exchange into something to maintain. There are exactly two things you can
do: throw a bottle, or catch one. Tested: no route lists bottles, visitors
or logs (`spec/permissions.test.ts`).

## Anonymous

Nobody using the app learns who anyone else is: no account, no name, no
profile. A bottle is just `id, message, created_at, caught_at`, with no
sender or receiver column. Crit 10 forced a trade-off: the server gives
each browser a random,
signed pseudonym in an HttpOnly cookie, and operator-only logs record which
pseudonym threw or caught — never the message or which bottle. That
pseudonym is a browser, not a person. Tested: pages and ripples never expose
a pseudonym; logs never hold messages (`spec/permissions.test.ts`,
`spec/logging.test.ts`). Judged: a message can still identify its author.

## Surprising

Catching returns exactly one random uncaught message — no preview, no
choosing — and this is tested, not asserted: of two simultaneous catches at
one bottle, exactly one succeeds (`spec/bottles.test.ts`).
It's the one promise I'd call non-negotiable.

What's judged rather than tested is how alive the ocean feels: settled by
watching it run in a browser and rejecting passes that didn't work, not by a
green test suite. It's a moonlit sea with partly-submerged decorative
bottles standing in for how many uncaught messages exist. The count behind
them is exact and tested up to three; how many are drawn varies with screen
size. Throwing or catching also sends everyone with the page open
a silent ripple across the water — a sign something
happened, never who or what. That's why it's better shared: alone you see
only your own ripples; with others here, theirs reach you too.

## Human

Messages are plain text, capped at 280 characters — no formatting, no
attachments, no AI-assisted writing. What shows up is whatever someone
actually chose to send. The cap and plain text are tested
(`spec/bottles.test.ts`); the rest, by absence.
