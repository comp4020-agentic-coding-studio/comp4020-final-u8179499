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

Nobody's identity is captured anywhere, not a name, not a cookie, not a
session token. A bottle is just `id, message, created_at, caught_at` — there
is no sender or receiver column at all. This isn't a privacy setting I turned
on; the data to de-anonymise anyone was never collected in the first place.

## Surprising

Catching a bottle returns exactly one random uncaught message — no preview,
no filtering, no choosing. Once it's caught, that specific bottle is gone for
good and can never be caught again. You can absolutely throw or catch again
later, but every single catch is still one blind draw, same as the last.

## Human

Messages are plain text, capped at 280 characters — no formatting, no
attachments, no hashtags, and nothing AI-assisted about writing one. What
shows up is only ever what a real person sat down and typed, short enough to
be a note rather than a post.
