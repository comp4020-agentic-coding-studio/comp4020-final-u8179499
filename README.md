# Message in a Bottle

Write a message, throw it into the ocean, and it's gone from you. Someone else
catches a random bottle and reads it. That's the whole app: **write → throw →
catch → read**. No feed, no accounts, no way to pick which bottle you get.

## What "good" means here (first pass)

I want this to feel like something small and made-by-hand, not like a
miniature social network. The two things I read while deciding what "good"
meant for this app:

- Robin Sloan, [*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/) —
  his contrast between an app built for the people you actually know and an
  app built to scale to millions is basically the whole design brief for this
  project. A home-cooked app doesn't need a growth strategy, so it doesn't
  need the things that come with one: accounts, engagement counts, a feed.
- [PostSecret](https://en.wikipedia.org/wiki/PostSecret) — the closest real
  precedent I could find for "a stranger sends something anonymous and
  another person just encounters it." But PostSecret still has a curator:
  Frank Warren reads everything and chooses what gets shown, in what order.
  There's a selecting hand. I didn't want one. Catching a bottle here is a
  blind, unmediated draw — nobody, including the app, decides what you get.

That distinction from PostSecret is where "surprising" below comes from, and
it's the main way this app isn't just a smaller PostSecret.

## Small

No accounts, no login, no follower or catch counts, no list of bottles to
scroll through — not even for the person who threw one. There are exactly two
things you can do: throw a bottle, or catch one. Nothing to browse in
between, because there's nothing here designed to hold your attention.

## Anonymous

The app stores nothing about who you are: no account, no name, no cookie, no
session identifier. A bottle is just `id, message, created_at, caught_at` —
there is no sender or receiver column at all. This isn't a privacy setting I
turned on; the app simply never records who threw or caught a bottle. What
you write is still up to you, and a message can say who wrote it if its
writer chooses.

## Surprising

Catching a bottle returns exactly one random uncaught message — no preview,
no filtering, no choosing. Once it's caught, that bottle leaves the ocean and
can never be caught again. You can absolutely throw or catch again later, but
every single catch is still one blind draw, same as the last.

The ocean itself is the trace that's left behind: a moonlit night sea that
drifts and rocks on its own, decorated with partly-submerged bottles that
represent how many uncaught messages are out there — not the messages
themselves. None of them can be clicked, picked, or previewed; they're a
visual count, not a list, and not a one-to-one stand-in for any particular
stored bottle. When there's one, two, or three uncaught bottles out there,
that many decorative bottles drift across the water — no more, no less. Once
there are **four or more**, the water just looks lively: a handful of
decorative bottles drift in and out, the number varying over time, so you can
no longer tell how many are really out there, only that there are several.
The app itself never states an exact count once it passes three — though
that's a statement about what the API reports, not a guarantee that the real
number is unknowable to a patient observer who sits and watches every throw
and catch for long enough.

Throwing or catching also sends a brief, silent ripple across the water to
everyone who currently has the page open, including you. It reveals that a
throw or a catch just happened — that much is visible — but nothing more: no
message content, no identity, and no count. Once every bottle has been
caught, the ocean is empty. It never tells you whose bottles they are or
what they say, and you can't pick one out.

## Human

Messages are plain text, capped at 280 characters — no formatting, no
attachments, no hashtag features, and the app offers no AI-assisted writing.
What shows up is whatever someone chose to send, short enough to be a note
rather than a post.
