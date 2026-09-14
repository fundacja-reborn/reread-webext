import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The bar stuck to the top of every page (D219): the reading list, the
 * highlights, the saved phrases and the settings wear the article view's
 * stuck box now - one `.page-chrome` in page.css, the reader's own class
 * kept for what only the article view does (the ribbon that folds the bar
 * away). Its height is a token the pages lean on: `scroll-padding-top`
 * keeps anchors and focused rows out from under the bar, and the bar's box
 * takes the token as its height outright, so the number and the bar on
 * screen cannot quietly part. The rules are markup and stylesheets, so this
 * reads them the way `reader-fullscreen-tool` does.
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

describe("the bar stuck to the top of every page", () => {
  it("is one box in one home: stuck at the window's top, on its own paper, above the page, with no transition", async () => {
    const box = ruleOf(await source("assets/page.css"), ".page-chrome");
    assert.match(box, /position: sticky;/, "the box scrolls away with the page");
    assert.match(box, /top: 0;/, "the box sticks somewhere below the window's top");
    assert.match(box, /background: var\(--page-bg\);/, "the page would show through the stuck box");
    // Above the scrim (1) and above everything in a list - the highlighter's
    // pins and badges stand at 0 for this reason.
    assert.match(box, /z-index: 2;/, "the box lost its place over the scrim and the lists");
    assert.match(box, /padding-top: var\(--header-air\);/, "the stuck box holds no paper over the bar");
    assert.doesNotMatch(box, /transition/, "the box animates, which an e-ink panel draws as a smear");
  });

  it("is the reader's box on the reading list and the highlights too, the folding kept to the article view", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<div class="reader-chrome page-chrome">/, "the reader's box does not wear the shared class");
    assert.match(markup, /<header class="reader-bar page-bar">/, "the reader's bar does not wear the shared class");
    const styles = await source("reader/reader.css");
    assert.doesNotMatch(styles, /position: sticky/, "the reader sticks a box of its own beside the shared one");
    assert.doesNotMatch(styles, /\n\.reader-chrome \{/, "the reader dresses its box twice");
    assert.doesNotMatch(styles, /\n\.reader-bar \{/, "the reader dresses its bar twice");
    // The ribbon folds the bar only over an article: a list keeps its whole
    // chrome, and the shared rule must not fold it.
    assert.match(
      styles,
      /:root\[data-reader-chrome="hidden"\] body\.reader:has\(#article:not\(\[hidden\]\)\) \.reader-chrome > :not\(\.chrome-tab\) \{\s*display: none;/,
      "the bar folds away outside the article view",
    );
    for (const page of ["vocab/vocab.html", "options/options.html"]) {
      const other = await source(page);
      assert.match(other, /<div class="page-chrome">/, `${page} has no shared box`);
      assert.match(other, /<div class="page-bar">/, `${page} has no shared bar`);
    }
  });

  it("has a height the stylesheet knows, as one token every page shares, which the bar's box takes outright", async () => {
    const styles = await source("assets/page.css");
    assert.match(styles, /--header-h: calc\(var\(--header-air\) \+ var\(--bar-h\)\);/, "the bar's reach is not one token");
    const bar = ruleOf(styles, ".page-bar");
    assert.match(bar, /height: var\(--bar-h\);/, "the bar's box is left to measure itself");
    assert.match(bar, /border-bottom: 1px solid var\(--page-line\);/, "the line under the bar is not the separators' token");
    assert.doesNotMatch(bar, /transition/, "the bar animates");
    // The bar is interface (D104): nothing in it follows the Aa panel's size.
    assert.doesNotMatch(bar, /--reader-size/, "the bar's height follows the text size");
    // The floor the token counts is the floor the tools stand on, on every
    // page - the reader's tools keep their own rule and must stand on the
    // same number.
    const parts = /--bar-h: calc\((\d+(?:\.\d+)?rem) \+ (\d+(?:\.\d+)?rem) \+ 1px\);/.exec(styles);
    assert.ok(parts !== null, "the bar's height is not the tools' floor, the air under them and the line");
    const [, floor, air] = parts;
    assert.match(ruleOf(styles, ".page-tools > button"), new RegExp(`min-height: ${floor};`), "the tools stand on another floor than the token counts");
    assert.match(bar, new RegExp(`padding-bottom: ${air};`), "the air under the tools is not what the token counts");
    const reader = await source("reader/reader.css");
    assert.match(reader, new RegExp(`#menu \\{[^}]*min-height: ${floor};`), "the reader's tools stand on another floor than the token counts");
  });

  it("holds nothing any more: the hold module went with the offset it measured", async () => {
    await assert.rejects(source("lib/chrome-hold.js"), "the hold module is still in the package");
    for (const path of ["assets/page.css", "reader/reader.css", "reader/reader.js", "vocab/vocab.js", "options/options.js"]) {
      assert.doesNotMatch(await source(path), /--chrome-hold|holdChrome/, `${path} still holds the chrome`);
    }
  });
});
