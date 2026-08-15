import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

/**
 * The two marks this extension paints on a page it does not own - the underline
 * of a saved phrase and the wash under the phrase an open recall bubble is
 * about (D89) - and the tint gate on the bubble's dictionary lines. All three
 * are contracts between files that never import each other: a highlight name
 * lives once in `highlighter.js` and once in `highlight.css`, and a rename on
 * either side is not an error anywhere - the mark is simply, silently gone.
 * No browser runs in CI, so what can be held is the agreement itself.
 *
 * @param {string} path
 */
async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("the marks on the page", () => {
  it("names each highlight the same in the script and in the stylesheet", async () => {
    const script = await read("../src/content/highlighter.js");
    const sheet = await read("../src/content/highlight.css");

    for (const name of ["reread", "reread-active"]) {
      assert.ok(script.includes(`"${name}"`), `highlighter.js no longer registers "${name}"`);
      assert.ok(sheet.includes(`::highlight(${name})`), `highlight.css no longer styles ::highlight(${name})`);
    }
  });

  it("washes the recalled phrase in the page's own ink, never in a colour of ours", async () => {
    const sheet = await read("../src/content/highlight.css");
    const start = sheet.indexOf("::highlight(reread-active)");
    const block = sheet.slice(sheet.indexOf("{", start) + 1, sheet.indexOf("}", start));

    // The same rule the underline lives by: a fixed colour has to be a
    // compromise between light pages and dark ones, and a compromise that
    // reads everywhere is loud somewhere. `currentColor` answers per page.
    assert.match(
      block,
      /background-color:\s*color-mix\(in srgb, currentColor \d+%, transparent\)/,
      "the recall mark stopped being a wash of currentColor",
    );
  });

  it("keeps the dictionary lines' hover tint away from the touch tier", () => {
    // Innermost rules only, which every `.entry-sense` rule is - the media
    // query wrapping the dark theme never matches this shape itself.
    let found = 0;
    for (const [, selector, body] of STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!(selector ?? "").includes(".entry-sense") || !(selector ?? "").includes(":hover")) continue;
      if (!/background/.test(body ?? "")) continue;
      found += 1;
      // Under a finger :hover is an emulation: it paints the line a scroll is
      // passing through and sticks after the finger lifts. The gate is the
      // gesture's own attribute, because the pointer media query answers
      // wrong on an e-ink tablet (D84).
      assert.ok(
        (selector ?? "").includes('.bubble:not([data-pointer="coarse"])'),
        `a hover tint on a dictionary line is not gated to the mouse: "${(selector ?? "").trim()}"`,
      );
    }
    assert.ok(found >= 2, "the hover tint rules went missing - both themes had one");
  });
});
