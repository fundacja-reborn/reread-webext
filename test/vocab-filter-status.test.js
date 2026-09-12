import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The filter's state over the list of saved phrases (the panel's polish
 * round, block 2): "1 of 827 phrases for "news" · Clear filter" right where
 * the rows are, because the filter box at the top of the page is off the
 * screen by the time the list is read - and "Show in list" in the fold
 * fills that box unseen. Read at the call sites, the way the fold's tests
 * are: the rules it leans on (`listView`, `filterActive`) have their own.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the filter's state over the list", () => {
  it("stands between the fold and the list, hidden until the filter asks anything", async () => {
    const markup = await source("vocab/vocab.html");
    const line = markup.indexOf('id="filter-status"');
    assert.notEqual(line, -1, "the page has no state line");
    assert.ok(markup.indexOf('id="add-phrase"') < line && line < markup.indexOf('id="list"'), "the line does not stand between the fold and the list");
    assert.match(markup, /id="filter-status" class="hint filter-status" hidden/, "the line stands before the script fills it, or not in the counter's voice");
    // Hidden, not invisible: out of the flow, so the rows do not move when
    // it goes.
    const styles = await source("vocab/vocab.css");
    assert.doesNotMatch(styles.slice(styles.indexOf(".filter-status {")), /visibility: hidden|position: sticky/, "the line keeps its height empty, or sticks");
  });

  it("says the count in the counter's own family, with Clear filter beside it, on every repaint", async () => {
    const script = await source("vocab/vocab.js");
    assert.match(bodyOf(script, "renderList"), /renderFilterStatus\(view\.matching\)/, "a repaint of the list leaves the state line stale");
    const line = bodyOf(script, "renderFilterStatus");
    assert.match(line, /const asking = filterActive\(query\);\s*filterStatus\.hidden = !asking;/, "the line stands while the filter asks nothing");
    assert.match(line, /plural\(phrases\.length, "vocab_filter_status", \[matching\.toLocaleString\(\), query\.trim\(\)\]\)/, "the sentence is not the counter's family over the total, with the count and the query riding along");
    assert.match(line, /button\(t\("vocab_filter_clear"\)\)[\s\S]*?clear\.className = "quiet quiet-clear"/, "Clear filter is not the quiet 44px button");
    assert.match(line, /clear\.addEventListener\("click", \(\) => clearFilter\(\)\)/, "Clear filter does not clear");
  });

  it("clears without the page jumping: the whole list back on page one, the focus on the list itself", async () => {
    const script = await source("vocab/vocab.js");
    const clearing = bodyOf(script, "clearFilter");
    assert.match(clearing, /query = "";\s*page = 1;/, "the filter is not emptied, or the page not turned back");
    assert.match(clearing, /filterInput\.value = ""/, "the filter box keeps the old query");
    assert.match(clearing, /listContainer\?\.focus\(\{ preventScroll: true \}\)/, "the focus does not land on the list, or the page scrolls");
    assert.doesNotMatch(clearing, /scrollIntoView|filterInput\.focus/, "clearing jumps the page to the filter box");
    assert.match(await source("vocab/vocab.html"), /id="list" class="phrases" tabindex="-1"/, "the list cannot take the focus");
  });

  it("says a filter that matches nothing once - the state line, not a second sentence in the list", async () => {
    const script = await source("vocab/vocab.js");
    assert.doesNotMatch(script, /noMatch|vocab_filter_no_match/, "the list says the filter matched nothing under the line that already says so");
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = await source(`_locales/${locale}/messages.json`);
      assert.match(catalogue, /"vocab_filter_status_one"/, `${locale} has no state line`);
      assert.doesNotMatch(catalogue, /"vocab_filter_no_match"/, `${locale} keeps the sentence nobody says`);
    }
  });
});
