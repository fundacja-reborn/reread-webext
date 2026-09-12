import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * A row of the saved-phrases page as the compact layout round (D211) laid
 * it out: three parts in one order at every width - the head with the
 * phrase and its counts, the body with the meanings and the sentence, the
 * actions last - the counts as glyphs with a number, a legend over the
 * list, the actions on the phrase's line. Read at the call sites, the way
 * the filter's state line is tested: what the DOM order and the sheet
 * promise is exactly what a smoke test in one browser cannot prove for the
 * others.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * One CSS rule's declarations, by the exact selector line that opens it.
 *
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function rule(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("a row of the saved phrases", () => {
  it("is built head, body, actions - the order the keyboard and a screen reader walk", async () => {
    const row = bodyOf(await source("vocab/vocab.js"), "phraseRow");
    const head = row.indexOf('element("div", "phrase-head")');
    const body = row.indexOf('element("div", "phrase-body")');
    const actions = row.indexOf('element("div", "phrase-actions")');
    assert.ok(head !== -1 && body !== -1 && actions !== -1, "a part of the row is missing");
    assert.ok(head < body && body < actions, "the parts are not built head, body, actions");
    // The phrase and its counts share the head; the meanings and the
    // sentence share the body - the same order on a phone and on a desktop.
    assert.match(row, /head\.append\(word\)/, "the phrase does not stand in the head");
    assert.match(row, /body\.append\(meanings\)/, "the meanings do not stand in the body");
    assert.match(row, /const fold = element\("details", "phrase-sentence"\);[\s\S]*?body\.append\(fold\)/, "the sentence does not stand in the body");
    assert.match(row, /row\.append\(head\);[\s\S]*row\.append\(body\);[\s\S]*row\.append\(actions\)/, "the row is not appended head, body, actions");
  });

  it("lays the row out as one wrapping line on a phone and three columns from 40rem", async () => {
    const styles = await source("vocab/vocab.css");
    const phone = rule(styles, ".phrase-row");
    assert.match(phone, /display: flex;\s*flex-wrap: wrap;/, "the phone row is not a wrapping line");
    // The head takes its own width and grows; the actions wrap under it
    // only when the phrase's own width plus the buttons will not fit - a
    // fixed floor on the head would drop them under every phrase at 360px.
    assert.match(rule(styles, ".phrase-head"), /order: 1;\s*flex: 1 1 auto;\s*min-width: 0;/, "the head does not grow from its own width");
    assert.match(rule(styles, ".phrase-actions"), /order: 2;[\s\S]*margin-inline-start: auto;/, "the actions do not stand at the line's end");
    assert.match(rule(styles, ".phrase-body"), /order: 3;\s*flex: 1 1 100%;/, "the body does not take the next line whole");
    // One breakpoint, in rem like the pager's: the grid with the three
    // named areas, the actions out of the baseline group.
    const desktop = styles.slice(styles.indexOf("@media (min-width: 40rem)"));
    assert.notEqual(desktop.length, 0, "no 40rem breakpoint");
    assert.doesNotMatch(styles, /@media \(min-width: 600px\)/, "a second breakpoint in px survives");
    assert.match(rule(desktop, "  .phrase-row"), /display: grid;\s*grid-template-columns: minmax\(10rem, 1fr\) minmax\(0, 2fr\) auto;\s*grid-template-areas: "head body actions";[\s\S]*align-items: baseline;/, "the desktop row is not the three-column grid");
    assert.match(rule(desktop, "  .phrase-actions"), /grid-area: actions;\s*align-self: start;/, "the actions are not at the row's top, out of the baseline group");
  });

  it("dresses the phrase, the meanings and the sentence in the Aa panel's size, and nothing above them", async () => {
    const styles = await source("vocab/vocab.css");
    const bare = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    // The reading size is set on the content elements themselves; a
    // container carrying it would hand it to the counts and the buttons.
    for (const selector of [".phrase-row", ".phrase-head", ".phrase-body", ".phrases"]) {
      assert.doesNotMatch(rule(bare, selector), /--reader-size|font-size/, `${selector} sets a size its interface children would inherit`);
    }
    assert.match(bare, /\.phrase-word,\s*\.phrase-meanings,[^{]*\{\s*font-family: var\(--reader-font-lead, var\(--reader-font-stack\)\);\s*font-size: var\(--reader-size, 18px\);/, "the phrase and the meanings do not wear the reading face and size");
    assert.match(rule(bare, ".phrase-sentence > summary"), /font-size: var\(--reader-size, 18px\);/, "the sentence does not wear the reading size");
  });
});
