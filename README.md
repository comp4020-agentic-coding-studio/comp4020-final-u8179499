# Message in a Bottle

Write a message, throw it into the ocean, and it's gone from you. Someone else
catches a random bottle and reads it. That's the whole app: **write → throw →
catch → read**. No feed, no accounts, no way to pick which bottle you get.

## What "good" means here (first pass)

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
do: throw a bottle, or catch one.

## Anonymous

The app stores nothing about who you are: no account, no name, no cookie, no
session identifier. A bottle is just `id, message, created_at, caught_at`,
with no sender or receiver column. This isn't a privacy setting I turned on;
the app simply never learns who threw or caught anything. What you
write is still your choice: a message could name its author or describe
something identifying, and the app can't stop that — anonymity here is about
what the system records, not what someone chooses to say.

## Surprising

Catching returns exactly one random uncaught message — no preview, no
choosing — and this is checked, not asserted: a concurrent-catch test fires
two simultaneous catches at one bottle and confirms exactly one succeeds.
It's the one promise I'd call non-negotiable.

What's judged rather than tested is how alive the ocean feels: settled by
watching it run in a browser and rejecting passes that didn't work, not by a
green test suite. It's a moonlit sea with partly-submerged decorative
bottles standing in for how many uncaught messages exist. That data —
exactly 0, 1, 2, or 3, then a deliberately vague "several" — is exact and
tested; how many are actually drawn, and where, is a separate artistic
choice I later let vary with screen size, not a promise every device
matches. Throwing or catching also sends everyone with the page open,
including you, a silent ripple across the water — a sign something
happened, never who or what. None of it is a literal counter: the ocean
tells you something is going on, never how much or by whom.

## Human

Messages are plain text, capped at 280 characters — no formatting, no
attachments, no AI-assisted writing. What shows up is whatever someone
actually chose to send.
