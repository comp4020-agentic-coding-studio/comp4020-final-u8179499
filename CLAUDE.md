# Your harness

These rules come directly from README.md's definition of good
(commit 7c96d67). If README.md changes, these rules change with it —
don't let them drift apart.

## The four constraints — never violate these

- **Small**: for Crit 8, the only two actions that exist are throw and
  catch — no accounts, no login, no follower or catch counts, no page
  or endpoint that lists or browses bottles. Later weeks may add new
  interactions if the Final Project requires them, but a new
  interaction must never turn this into a feed, a browsing experience,
  or a social network, and must never undermine README.md's definition
  of good.
- **Anonymous**: never store or derive anything that links an action to
  a person — no name, no cookie, no session token, no sender or
  receiver identity of any kind. The Crit 8 schema is
  `id, message, created_at, caught_at`; later weeks may add
  non-identifying fields if the Final Project's multi-user or
  real-time requirements need them, but no field may ever encode who
  did something.
- **Surprising**: catch never accepts a filter, search, or preview
  parameter, and never returns more than one bottle. Claiming a bottle
  must be atomic (a single `UPDATE ... WHERE caught_at IS NULL`, never
  select-then-update) so two simultaneous catches can't return the same
  bottle.
- **Human**: messages are plain text only, capped at 280 characters.
  Never add formatting, attachments, hashtags, or AI-assisted
  composition of the message itself.

## Crit 8 scope — don't build ahead of this week

- No seeding of fake bottles. If the ocean is empty, catch returns a
  clear message ("The ocean is quiet. No bottles to catch yet.") —
  never a crash, never a silent empty 200.
- No multi-user/real-time features, no per-visitor identity or catch
  history, no rooms. Those are later weeks' work, not this one's.
- Don't add likes, comments, profiles, or any feature not named in
  README.md, even if it would be quick to build.

## When something's wrong

- A failing check gets fixed by changing the app's behaviour or the
  README's claim — never by loosening the test until it's green.
- If you're about to add anything not covered by this file or
  README.md, stop and ask rather than build it.
