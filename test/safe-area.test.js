import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The strip a screen keeps for itself (D269). In full screen the browser's
 * own bars are gone and a phone's cutout - a notch, or the lens punched
 * through the panel - is left standing over the page; on a Pixel it stood
 * over the bar's tools (Michał's report, 2026-09-20). The browser knows how
 * much it took and says so in `env(safe-area-inset-top)`, so nothing here
 * guesses at a device: one token carries the number, the bar's box spends
 * it as paper, and every page that leans on the bar's reach follows.
 *
 * The rules are stylesheets and one shared module, so this reads them the
 * way `page-header` and `reader-fullscreen-tool` do.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The declarations of one rule, found by its selector standing alone on a
 * line - the first such rule in the sheet.
 *
 * @param {string} styles
 * @param {string} selector
 */
function ruleOf(styles, selector) {
  const at = styles.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return styles.slice(at, styles.indexOf("}", at));
}

describe("the screen's own inset", () => {
  it("is one token, zero until the page has the whole screen", async () => {
    const styles = await source("assets/page.css");
    assert.match(styles, /--safe-top: 0px;/, "the inset is not a token the pages can lean on");
    assert.match(
      ruleOf(styles, ":root:fullscreen"),
      /--safe-top: env\(safe-area-inset-top, 0px\);/,
      "the token does not take the screen's inset in full screen",
    );
    // Only in full screen. Firefox for Android folds its address bar on a
    // scroll and reports an inset for the page's window while it is gone,
    // and a bar that grew and shrank with the scroll is not a bar.
    const asked = styles.match(/env\(safe-area-inset-top/g) ?? [];
    assert.equal(asked.length, 1, "the top inset is taken somewhere besides the full-screen rule");
    // The fallback is what carries the promise that no device needs a
    // setting for this: a screen with nothing to avoid answers 0px.
    assert.doesNotMatch(styles, /env\(safe-area-inset-top\)/, "the inset is taken without a fallback for a screen that reports none");
  });

  it("is spent as the bar's own paper, so the tools stand below the lens", async () => {
    const box = ruleOf(await source("assets/page.css"), ".page-chrome");
    assert.match(box, /padding-top: calc\(var\(--safe-top\) \+ var\(--header-air\)\);/, "the stuck box does not carry the inset over the bar");
    assert.match(box, /background: var\(--page-bg\);/, "the strip over the bar is not the page's own paper");
  });

  it("is painted black, by the bar's box and again by a room standing over it", async () => {
    const styles = await source("assets/page.css");
    // 0.5.72 wore the page's paper there and the bar read as twice its
    // height on the Pixel (Michał's smoke, 2026-09-20): a white band under
    // a white bar has nothing to say it is not the bar.
    assert.match(styles, /--safe-fill: #000000;/, "the strip is not painted in one colour the pages share");
    for (const [sheet, selector, why] of /** @type {[string, string, string][]} */ ([
      ["assets/page.css", ":root:fullscreen .page-chrome::after", "the bar's box draws no strip"],
      ["reader/reader.css", ":root:fullscreen .room::after", "a room over an article covers the bar's strip and draws none of its own"],
    ])) {
      const strip = ruleOf(await source(sheet), selector);
      assert.match(strip, /content: "";/, `${selector}: ${why}`);
      // Fixed, not absolute: the box is a column (44rem at most) while the
      // strip is the window's whole width, and a fixed box adds nothing to
      // the page's overflow - so the 0px case costs no sideways scrollbar.
      assert.match(strip, /position: fixed;/, `${selector}: the strip is laid out in a column narrower than the window`);
      assert.match(strip, /inset-inline: 0;\s*top: 0;/, `${selector}: the strip does not stand across the window's top`);
      assert.match(strip, /height: var\(--safe-top\);/, `${selector}: the strip has a height of its own, not the screen's inset`);
      assert.match(strip, /background: var\(--safe-fill\);/, `${selector}: the strip is painted in something other than the shared colour`);
      assert.match(strip, /pointer-events: none;/, `${selector}: the strip takes presses meant for the page`);
    }
  });

  it("keeps the reader's ribbon and its rooms clear of the lens", async () => {
    const sheet = await source("reader/reader.css");
    // A bar folded behind its ribbon keeps no paper (D219's smoke), but in
    // full screen it keeps the inset: the ribbon hangs from the box.
    assert.match(
      sheet,
      /:root\[data-reader-chrome="hidden"\] body\.reader:has\(#article:not\(\[hidden\]\)\) \.reader-chrome \{\s*padding-top: var\(--safe-top\);/,
      "the folded bar puts its ribbon back under the lens",
    );
    // A room is a frame (D243), and the document inside a frame is told
    // nothing about the window's insets - so the room takes it instead.
    assert.match(ruleOf(sheet, ".room"), /padding-top: var\(--safe-top\);/, "a room in full screen begins at the window's edge, under the lens");
  });

  it("is asked of the browser only while the page has the screen", async () => {
    const module = await source("lib/fullscreen-tool.js");
    const ask = bodyOf(module, "armViewportFit");
    assert.notEqual(ask.length, 0, "the shared module never asks to be laid out under the cutout");
    assert.match(ask, /meta\[name=viewport\]/, "the ask is not made through the page's own meta viewport");
    assert.match(ask, /const inTab = meta\.content;/, "the sentence the page says in a tab is not kept");
    assert.match(
      ask,
      /document\.fullscreenElement === null \? inTab : `\$\{inTab\}, viewport-fit=cover`/,
      "the page wears the ask outside full screen, or drops what it said in a tab",
    );
    assert.match(ask, /document\.addEventListener\("fullscreenchange"/, "the ask does not follow the browser's state");
    // Before the tool and whether or not there is one: the screen is
    // entered from the reader's menu row as well, and left with Back.
    const arm = bodyOf(module, "armFullscreenTool");
    assert.ok(
      arm.indexOf("armViewportFit()") !== -1 && arm.indexOf("armViewportFit()") < arm.indexOf("if (tool === null)"),
      "a page whose row has no room for the tool is left under the lens",
    );
    // And no page wears it in a tab: Firefox for Android hands a page's
    // viewport-fit to the whole browser window, which would lay the
    // browser's own bars under the lens for as long as the page is open.
    for (const page of ["reader/reader.html", "vocab/vocab.html", "options/options.html", "popup/index.html"]) {
      assert.doesNotMatch(await source(page), /viewport-fit/, `${page} asks to be laid out under the cutout in a tab`);
    }
  });
});
