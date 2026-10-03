# Crit 8 reflection

## 1. What was the breakthrough that moved the work forward?

Realising that passing the tests did not mean the interaction was good. My
first implementation already passed every behavioural test: throwing saved a
bottle, a bottle could only be caught once, and the empty ocean behaved
properly. But when I actually opened it, it was just a generic form with two
buttons. Nothing about it felt like throwing a message into the sea.

Looking at the page and using it again and again changed the project far more
than another round of automated tests would have. It's how I moved from a
form to a night horizon to the daytime ocean I ended up with. It also exposed
real bugs the tests couldn't see. The Throw animation looked like it worked
in code, but the bottle never actually left the corner of the screen, because
the SVG transform was producing invalid numbers. I only found that by looking
closely at a screenshot.

## 2. What did this work change about who I want to be as a software developer?

I don't want to give an agent a prompt and accept whatever code comes back. I
want to define what "good" means first, give the agent constraints and tests
built from that definition, and then actually look at and use what it builds.
I also need to be willing to reject it or redirect it when it isn't right,
even when it technically works. This week I rejected a direction I had chosen
myself. To me, the important part of my role is judgment, not generating code.
