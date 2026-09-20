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
  it("stands under the byline, with only the site (D232) between them, hidden until there is something to say", async () => {
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
    assert.match(css, /\.reader-byline,\s*\.reader-source,\s*\.reader-facts,\s*\.reader-pictures\s*\{/);
    assert.match(css, /\.reader-byline:has\(~ :is\(\.reader-source, \.reader-facts, \.reader-pictures\):not\(\[hidden\]\)\)/);
  });
});

/**
 * The pictures line (D231): the menu row's offer said under the header,
 * where a reader who never opens the menu meets it. The state it reads is
 * tested in `reader-pictures.test.js` (`picturesState`); this reads the
 * places the line meets the page - its markup under the facts line, the
 * stylesheet that closes the facts line up to it, the press wired to the
 * row's own act, and the gesture hook that keeps a hold on the press from
 * becoming a word to select - for the reason the facts line's tests do.
 */
describe("the pictures line (D231) - the page", () => {
  it("stands right under the facts line, hidden until there is an offer", async () => {
    const html = await source("src/reader/reader.html");
    const facts = html.indexOf('<p id="facts" class="reader-facts" hidden></p>');
    const line = html.indexOf('<p id="pictures-offer" class="reader-pictures" hidden>');
    assert.ok(facts !== -1, "the facts line is not where it was");
    assert.ok(line > facts, "the pictures line does not follow the facts line");
    assert.ok(!html.slice(facts, line).includes("<div"), "something stands between the facts line and the pictures line");
    const content = html.indexOf('<div id="content">');
    assert.ok(content > line, "the pictures line does not stand before the text");
    assert.match(html, /<button type="button" id="pictures-offer-button"><\/button>/, "the press carries markup of its own");
  });

  it("is dressed like the facts line, which closes up to it", async () => {
    const css = await source("src/reader/reader.css");
    assert.match(css, /\.reader-facts:has\(~ \.reader-pictures:not\(\[hidden\]\)\)/);
    assert.match(css, /\.reader-pictures button \{/);
  });

  it("presses the row's own act, and is the reader's to press rather than the text's to select", async () => {
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /picturesOfferButton\?\.addEventListener\("click", \(\) => \{\s*void onPicturesPress\(\);/, "the press is not the row's act");
    assert.match(reader, /picturesOffer\?\.contains\(target\) === true/, "a hold on the press would select a word");
    assert.match(reader, /picturesState\(\{/, "the line does not read the row's state");
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

  it("is filled behind the list for the rows from before the count, once each", async () => {
    const reader = await source("src/reader/reader.js");
    // The list stands first; the pass is the last thing a refresh does.
    assert.match(reader, /applyLibrarySearchVisibility\(\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*void fillLengths\(entries\);\s*\}/);
    const body = reader.slice(reader.indexOf("async function fillLengths("));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    assert.match(fn, /uncounted\(entries, lengthsTried\)/, "the pass does not ask the pure rule which rows are owed");
    // A row is marked tried before anything is read, so a row that throws is
    // not asked again; and every row waits for a quiet moment first.
    assert.match(fn, /lengthsTried\.add\(entry\.url\);\s*\/\/[^\n]*\n\s*await quietMoment\(\);/);
    assert.match(fn, /await setWords\(entry\.url, wordsIn\(saved\.content\)\)/);
    assert.match(fn, /await backfillWords\(book\)/);
    // The list is drawn again only for something filled, and only while it
    // is the view on screen.
    assert.match(fn, /if \(filled > 0 && library !== null && !library\.hidden\) await refreshLibrary\(\);/);
  });

  it("is summed as a book's parts are written and written with its row, whichever file it came from", async () => {
    // The sum lives in the writer both imports feed (D230); each import
    // hands it to the row.
    const writer = await source("src/reader/book-parts.js");
    assert.match(writer, /words \+= wordsIn\(blocks\.join\(""\)\)/);
    for (const path of ["src/reader/import-book.js", "src/reader/import-markdown.js"]) {
      assert.match(await source(path), /cut: BOOK_CUT_VERSION,\s*words: parts\.words\(\),\s*\}\)/);
    }
  });

  it("stands on the list row between the date or the book's label and the pictures", async () => {
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /\[entry\.hostname, when, length, pictures, percent\]/);
    // A book's row said "Part 5 of 63" before the length until D270: the
    // stretches a long book is kept in are said nowhere, and the percent at
    // the row's end is of the whole book.
    assert.match(reader, /\[entry\.hostname, t\("reader_book_label"\), length, pictures, percent\]/);
  });
});
