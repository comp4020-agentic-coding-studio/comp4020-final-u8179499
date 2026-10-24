import axe from "axe-core";
import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// The accessibility floor the course sets for every site: axe's WCAG 2.1
// A/AA rules, run over the HTML the server sends for each page. Page scripts
// don't run (the same choice as invariants.test.ts), so this checks the markup
// every visitor gets before any JavaScript.
//
// jsdom has no layout or rendered colour, so axe can't decide colour contrast
// or target size here: it reports those as "incomplete", not as violations,
// and this check doesn't enforce them. They need a real browser.
const baseUrl = inject("baseUrl");

const WCAG_21_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(path: string): Promise<string[]> {
  const html = await (await fetch(new URL(path, baseUrl))).text();
  const dom = new JSDOM(html, { url: new URL(path, baseUrl).href, runScripts: "outside-only" });
  dom.window.eval(axe.source);
  const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(dom.window.document, {
    runOnly: { type: "tag", values: WCAG_21_AA },
  });
  dom.window.close();
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

for (const path of ["/", "/readme/"]) {
  it(`${path} has no axe WCAG 2.1 A/AA violations`, async () => {
    expect(await violations(path)).toEqual([]);
  });
}
