# Crit 10 reflection

## 1. What was the breakthrough that moved the work forward?

The breakthrough was realising that my original definition of Anonymous had to change. In Crit 8, I promised no cookies, no sessions, and no way for the server to know who threw or caught a bottle. But Crit 10 required the server to distinguish two people and log their actions. I couldn't keep both promises.

I decided to keep visitors anonymous to each other while allowing the server to recognise individual browsers. I chose signed anonymous cookies and server-side logs, without adding accounts or linking identities to messages in the database. This was a compromise, but it kept the main experience unchanged.

Testing was also important. Locally, two isolated Chrome contexts confirmed that the logs attributed Throw and Catch to the right browser. On the deployed server I only checked read-only: the signed cookie, startup and identity logs, and the secret on the Fly volume. A production Throw/Catch and the Crit 10 demonstration haven't happened yet.

## 2. What did this work change about who I want to be as a software developer?

This Crit made me more aware that my job is not just to ask an AI agent to implement a feature. I need to question its decisions and check whether its claims are supported by evidence.

One example was the SSE test helper. A review suggested there was a bug, but checking the actual code showed the problem did not exist. Instead of changing working code, we kept it and added a regression test.

I want to be a developer who can explain why a decision was made, recognise when an original design promise must change, and know the difference between passing tests and a feature actually working.
