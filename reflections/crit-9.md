# Crit 9 reflection

## 1. What was the breakthrough that moved the work forward?

Realising that "make it realtime" wasn't really a transport question. My
first instinct was to pick SSE vs. WebSockets vs. polling and start coding.
The actual hard part turned out to be upstream of that: our only shared
state, `GET /api/ocean`'s `{ empty }` boolean, barely moves — it only flips
on the ocean's first and last bottle. Pushing that field live would have
"worked" and still shown almost nothing in a real demo. So the real decision
was product, not plumbing: what does multi-user mean for *this* app. I
rejected presence counts and a bucketed fullness state because both leak
more than README's Surprising and Anonymous promise, and landed on
**anonymous live activity, not presence** — every Throw/Catch pulses the
ocean for everyone, including the person who acted, with zero identity or
count attached. Transport (SSE) was then just the smallest way to deliver
that decision over our existing plain `node:http` stack.

The mistakes taught me as much as the decision did. A Vitest parallelism bug
made me suspect my own Crit 8 tests before I found the real cause. A
`res.flushHeaders()` bug taught me that "the tests time out" and "the
feature is broken" aren't the same diagnosis. And catching my own
verification script treating a Promise as a boolean — on production,
against a real bottle I'd left floating there — was a reminder to doubt my
own checks as hard as I doubt the code.

## 2. What did this work change about who I want to be as a software developer?

I want the trade-off to stay visible, not quietly fixed: a disconnected
client misses ephemeral activity, on purpose. Bottles persist; who noticed
them doesn't have to.
