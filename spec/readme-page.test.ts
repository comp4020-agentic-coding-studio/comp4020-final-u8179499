import { expect, inject, it } from "vitest";

// spec/invariants.test.ts already checks that every README heading appears,
// in order, as *text* on /readme/ — true even of the old plain-<pre> version,
// which never rendered Markdown at all. These specs cover what that one
// doesn't: that README.md's Markdown is actually interpreted into semantic
// HTML (not shown as literal source) and that its two reference links come
// through as real, correctly-targeted hyperlinks, not just escaped text.
const baseUrl = inject("baseUrl");

it("/readme/ renders headings as real heading elements, not literal Markdown text", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  const html = await res.text();

  expect(html).toContain("<h1>");
  expect(html).toContain("<h2>");
  // the old implementation wrapped the whole README in one <pre>; this guards
  // against ever falling back to showing raw Markdown source again
  expect(html).not.toContain("<pre>");
  expect(html).not.toMatch(/^##\s/m);
});

it("/readme/ renders the Robin Sloan and PostSecret references as real, correctly-targeted links", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  const html = await res.text();

  expect(html).toContain('<a href="https://www.robinsloan.com/notes/home-cooked-app/">');
  expect(html).toContain('<a href="https://en.wikipedia.org/wiki/PostSecret">');
});

it("/readme/ renders bold and inline code as real elements, not literal Markdown syntax", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  const html = await res.text();

  expect(html).toContain("<strong>");
  expect(html).toContain("<code>");
  // no stray, unrendered emphasis or code-span markers left in the output
  expect(html).not.toMatch(/\*\*/);
  expect(html).not.toMatch(/`/);
});

it("/readme/ has a Back to Ocean link that points at /", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  const html = await res.text();

  expect(html).toMatch(/<a[^>]+href="\/"[^>]*>[^<]*Back to Ocean/);
});
