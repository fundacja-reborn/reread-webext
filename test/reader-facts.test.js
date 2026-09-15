import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The facts line over an article and the length on a list row (D226): the
 * words, about how long they take, and how many saved phrases the paint
 * found. The counting has its tests in `length.test.js`, the rows' fields
 * in `saved-article.test.js` and `book.test.js`; this reads the places
 * they meet - the header's markup, the stylesheet under it, the hook the
 * reading side reports through and the reader page's hand on it - because
 * a line nobody draws or a hook nobody passes is a feature that silently
 * does nothing, and no unit test catches that by asking a function.
 */

const ROOT = new URL("../", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the facts line (D226) - the page", () => {
  it("stands right under the byline, hidden until there is something to say", async () => {
    const html = await source("src/reader/reader.html");
    const byline = html.indexOf('<p id="byline" class="reader-byline" hidden></p>');
    const facts = html.indexOf('<p id="facts" class="reader-facts" hidden></p>');
    assert.ok(byline !== -1, "the byline is not where it was");
    assert.ok(facts > byline, "the facts line does not follow the byline");
    const between = html.slice(byline, facts);
    assert.ok(!between.includes("<div"), "something stands between the byline and the facts line");
  });

  it("is dressed like the byline, and the byline closes up to it", async () => {
    const css = await source("src/reader/reader.css");
    assert.match(css, /\.reader-byline,\s*\.reader-facts\s*\{/);
    assert.match(css, /\.reader-byline:has\(\+ \.reader-facts:not\(\[hidden\]\)\)/);
  });
});

describe("the facts line (D226) - the count of phrases", () => {
  it("is reported by the reading side after every paint, through a hook the reader passes", async () => {
    const reading = await source("src/content/reading.js");
    assert.match(reading, /onPainted\?\.\(foundPhrases\(\)\)/, "repaint does not report");
    assert.match(reading, /onPainted = where\.onPainted \?\? null/, "start takes no hook");
    assert.match(reading, /^  onPainted = null;$/m, "stop leaves the hook behind");
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /onPainted: \(found\) => \{/, "the reader passes no hook");
    assert.match(reader, /foundPhrases = found;\s*renderFacts\(\);/, "the hook does not redraw the line");
  });

  it("answers nothing, not zero, where nothing can be painted", async () => {
    const reading = await source("src/content/reading.js");
    const body = reading.slice(reading.indexOf("function foundPhrases()"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    assert.match(fn, /vocabulary\.size === 0 \|\| !supported\(\)\) return null/);
  });
});

describe("the facts line (D226) - the count of words", () => {
  it("is taken off the markup a save would write, before the paint is asked for", async () => {
    const reader = await source("src/reader/reader.js");
    const counted = reader.indexOf("shownWords = wordsIn(rebuilt.innerHTML);");
    const rescan = reader.indexOf("rootReadingSide(article);\n  rescan();\n  renderFacts();");
    assert.ok(counted !== -1, "the render does not count");
    assert.ok(rescan > counted, "the count comes after the paint, or the line is not drawn after it");
  });

  it("fills a row from before the count on its next open - articles and books alike", async () => {
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /if \(saved\.words === undefined\) void setWords\(url, shownWords\)/);
    assert.match(reader, /if \(book\.words === undefined\) void backfillWords\(book\)/);
    assert.match(reader, /await setBookWords\(book\.id, words\)/);
  });

  it("is summed at a book's import and written with its row", async () => {
    const importer = await source("src/reader/import-book.js");
    assert.match(importer, /words \+= wordsIn\(blocks\.join\(""\)\)/);
    assert.match(importer, /cut: BOOK_CUT_VERSION,\s*words,\s*\}\)/);
  });

  it("stands on the list row between the date or the part and the pictures", async () => {
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /\[entry\.hostname, when, length, pictures, percent\]/);
    assert.match(reader, /\[entry\.hostname, t\("reader_book_label"\), progress, length, pictures, percent\]/);
  });
});
