import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLACE_TITLE_CAP,
  PLACE_TITLE_MIN,
  headingEntries,
  isPlace,
  placeEntry,
  placePercent,
  placeTitle,
  wantsPlaces,
} from "../src/lib/book/toc.js";
import { overallPercent } from "../src/lib/reader/position.js";

// The contents of a book without headings (D271). Since D270 the stretches a
// long book is kept in are said nowhere, so a book whose text has no h1-h3
// had nothing left to move about by: no chapters to list, no parts to turn.
// Its contents are places - one row per stretch, named by the first words
// standing there, with how far into the book that is. The naming is a pure
// rule over stored blocks and is tested here; that the page builds the list
// behind the reading, shows it in the dialog and keeps it out of the search
// is read from the sources, since the page only exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), "utf8");

// Written as codes so they stay visible in a diff.
const NBSP_ENTITY = "&nbsp;";
const ELLIPSIS = String.fromCodePoint(0x2026);
const EM_DASH = String.fromCodePoint(0x2014);

describe("placeTitle", () => {
  it("names a stretch by the first words standing in it, and lands on their block", () => {
    const named = placeTitle([
      "<p>The Salinas Valley is in Northern California. It is a long narrow swale between two ranges of mountains.</p>",
      "<p>I remember my childhood names for grasses and secret flowers.</p>",
    ]);
    assert.deepEqual(named, {
      title: `The Salinas Valley is in Northern California. It is a long${ELLIPSIS}`,
      blockIndex: 0,
    });
    assert.ok((named?.title.length ?? 0) <= PLACE_TITLE_CAP);
  });

  it("keeps a short text whole, with no ellipsis to promise more", () => {
    assert.deepEqual(placeTitle(["<p>It was a deluge of a winter.</p>"]), {
      title: "It was a deluge of a winter.",
      blockIndex: 0,
    });
  });

  it("steps over a picture, a rule and a row of asterisks to the first words", () => {
    const named = placeTitle([
      '<figure><img src="book-picture:3" alt=""></figure>',
      "<hr>",
      "<p>* * *</p>",
      "<p>Adam Trask was born on a farm on the outskirts of a little town.</p>",
    ]);
    assert.equal(named?.blockIndex, 3, "the landing shows the words the row promised");
    assert.match(named?.title ?? "", /^Adam Trask was born/);
  });

  it("reads a picture's alt text and attributes as markup, never as words", () => {
    assert.equal(placeTitle(['<figure><img src="x" alt="A map of the valley > north"></figure>']), null);
  });

  it("carries a very short first paragraph on into the words after it", () => {
    // A chapter number set as a plain paragraph, a line of dialogue: alone
    // they would name sixty places "I" to "LX", or nothing at all.
    const numbered = placeTitle(["<p>XII</p>", "<p>Adam looked up from the ledger and said nothing for a while.</p>"]);
    assert.equal(numbered?.blockIndex, 0);
    assert.match(numbered?.title ?? "", /^XII Adam looked up from the ledger/);

    const spoken = placeTitle(["<p>- Yes.</p>", "<p>- And you never told him?</p>", "<p>Cal did not answer.</p>"]);
    assert.equal(spoken?.title, "- Yes. - And you never told him?");
    assert.ok((spoken?.title.length ?? 0) >= PLACE_TITLE_MIN);
  });

  it("stops collecting once there is enough to recognize the place by", () => {
    const named = placeTitle(["<p>A first paragraph long enough by itself.</p>", "<p>NEVER READ</p>"]);
    assert.equal(named?.title, "A first paragraph long enough by itself.");
  });

  it("decodes the serializer's entities, ampersand last", () => {
    assert.equal(
      placeTitle([`<p>Tom &amp; Dessie${NBSP_ENTITY}&lt;the twins&gt; wrote &amp;lt; once.</p>`])?.title,
      "Tom & Dessie <the twins> wrote &lt; once.",
    );
  });

  it("takes inline markup off and keeps the words", () => {
    assert.equal(
      placeTitle(['<p><em>Timshel</em>, said <span dir="a>b">Lee</span>, and nothing more was said.</p>'])?.title,
      "Timshel, said Lee, and nothing more was said.",
    );
  });

  it("takes a footnote's mark out whole, its note with it", () => {
    const named = placeTitle([
      '<p>The valley<sup><a data-note="A note that says > a lot, &quot;quoted&quot;.">1</a></sup> was his whole world then.</p>',
    ]);
    assert.equal(named?.title, "The valley was his whole world then.");
    // An anchor that is no footnote keeps its words.
    assert.equal(placeTitle(["<p>See <a>the second chapter</a> for the rest of it.</p>"])?.title, "See the second chapter for the rest of it.");
  });

  it("cuts at a space, and drops what may not stand before the ellipsis", () => {
    // The last whole word inside the cap ends on a comma, which goes.
    const words = "One two three four five six seven eight nine ten eleven twelve, thirteen fourteen fifteen";
    const named = placeTitle([`<p>${words}</p>`]);
    assert.equal(named?.title, `One two three four five six seven eight nine ten eleven twelve${ELLIPSIS}`);

    const dashed = placeTitle([`<p>One two three four five six seven eight nine ten eleven ${EM_DASH} twelve thirteen fourteen</p>`]);
    assert.equal(dashed?.title, `One two three four five six seven eight nine ten eleven${ELLIPSIS}`);
  });

  it("cuts an unspaced script at the cap, and never inside a surrogate pair", () => {
    const han = String.fromCodePoint(0x6587).repeat(200);
    const cut = placeTitle([`<p>${han}</p>`])?.title ?? "";
    assert.equal(cut.length, PLACE_TITLE_CAP);
    assert.ok(cut.endsWith(ELLIPSIS));

    // Astral letters, two units each: the cap falls in the middle of one.
    const astral = String.fromCodePoint(0x20000).repeat(100);
    const safe = placeTitle([`<p>${astral}</p>`])?.title ?? "";
    assert.ok(safe.length <= PLACE_TITLE_CAP);
    const body = safe.slice(0, -1);
    assert.equal(body.length % 2, 0, "a half of a pair was left at the cut");
    assert.doesNotMatch(body, /[\uD800-\uDBFF]$/);
  });

  it("names a right-to-left text in its own, logical order", () => {
    // Hebrew letters as codes; the cut and the ellipsis follow reading
    // order, and which side the row draws them on is the row's dir="auto".
    const word = String.fromCodePoint(0x05d1, 0x05e8, 0x05d0, 0x05e9, 0x05d9, 0x05ea);
    const text = Array.from({ length: 20 }, () => word).join(" ");
    const named = placeTitle([`<p dir="rtl">${text}</p>`])?.title ?? "";
    assert.ok(named.startsWith(`${word} ${word}`));
    assert.ok(named.endsWith(`${word}${ELLIPSIS}`), "cut between two whole words");
    assert.ok(named.length <= PLACE_TITLE_CAP);
  });

  it("answers nothing for a stretch without words", () => {
    assert.equal(placeTitle([]), null);
    assert.equal(placeTitle(['<figure><img src="a" alt=""></figure>', "<hr>", "<p> </p>", "<p>***</p>"]), null);
  });
});

describe("placePercent", () => {
  it("says how far into the book a stretch begins", () => {
    assert.equal(placePercent(0, 63), 0);
    assert.equal(placePercent(1, 63), 2);
    assert.equal(placePercent(31, 63), 49);
    assert.equal(placePercent(62, 63), 98);
  });

  it("is the number the reading list shows for a reading standing at that first line", () => {
    for (const count of [2, 3, 7, 63, 400]) {
      for (let index = 0; index < count; index += 1) {
        const listed = overallPercent({ docId: "book:eden", segmentIndex: index, blockIndex: 0, percent: 0, updatedAt: 1 }, count);
        assert.equal(placePercent(index, count), listed, `${index} of ${count}`);
      }
    }
  });

  it("stays inside 0-100 whatever it is handed", () => {
    assert.equal(placePercent(5, 0), 0);
    assert.equal(placePercent(Number.NaN, 10), 0);
    assert.equal(placePercent(-3, 10), 0);
    assert.equal(placePercent(30, 10), 100);
  });
});

describe("placeEntry", () => {
  it("is a chapter row's shape with the percent on top, flat", () => {
    const place = placeEntry(["<hr>", "<p>Lee poured the ng-ka-py into the tiny cups.</p>"], 12, 48);
    assert.deepEqual(place, {
      title: "Lee poured the ng-ka-py into the tiny cups.",
      level: 1,
      segmentIndex: 12,
      blockIndex: 1,
      percent: 25,
    });
  });

  it("gives a stretch of pictures no row", () => {
    assert.equal(placeEntry(['<figure><img src="a" alt=""></figure>'], 3, 10), null);
  });
});

describe("isPlace", () => {
  it("tells a place from a chapter", () => {
    const place = placeEntry(["<p>Some first words of a stretch of a book.</p>"], 1, 4);
    assert.ok(place !== null && isPlace(place));
    const [chapter] = headingEntries(["<h1>Chapter One</h1>"], 0);
    assert.ok(chapter !== undefined && !isPlace(chapter));
  });
});

describe("wantsPlaces", () => {
  it("offers places to a long book without headings", () => {
    assert.equal(wantsPlaces([], 63), true);
  });

  it("offers them over a table of one row too - the title page's heading leads nowhere", () => {
    assert.equal(wantsPlaces(headingEntries(["<h1>East of Eden</h1>"], 0), 63), true);
  });

  it("leaves a book with chapters, a book in one stretch, and a row still owed its scan alone", () => {
    const chapters = headingEntries(["<h1>One</h1>", "<h1>Two</h1>"], 0);
    assert.equal(wantsPlaces(chapters, 63), false);
    assert.equal(wantsPlaces([], 1), false);
    assert.equal(wantsPlaces(null, 63), false);
  });
});

describe("the reader's page over a book without headings", () => {
  const script = read("src/reader/reader.js");
  const css = read("src/reader/reader.css");

  /**
   * One function of the reader's script, from its name to the next one's.
   *
   * @param {string} name
   * @param {string} next
   */
  function fn(name, next) {
    const from = script.indexOf(`function ${name}(`);
    const to = script.indexOf(`function ${next}(`, from);
    assert.ok(from >= 0 && to > from, `${name} before ${next}`);
    return script.slice(from, to);
  }

  it("dresses the book in its places at every open, and after the scan of an old row", () => {
    assert.match(fn("openBook", "washSearchHit"), /dressBookToc\(book, book\.toc\);/);
    assert.match(fn("backfillToc", "placesKey"), /dressBookToc\(book, toc\);/);
    const dress = fn("dressBookToc", "readPlaces");
    assert.match(dress, /if \(wantsPlaces\(toc, book\.segmentCount\)\)/);
    // Read once per tab: a list already read stands at once, so reading on
    // into the next stretch does not flicker the menu's row.
    assert.match(dress, /const known = bookPlaces\.get\(placesKey\(book\)\);/);
    assert.match(dress, /if \(known === undefined\) void readPlaces\(book\);/);
  });

  it("reads the places behind the reading and stores nothing", () => {
    const scan = fn("readPlaces", "backfillWords");
    assert.match(scan, /await quietMoment\(\);/);
    assert.match(scan, /placeEntry\(segment\.blocks, index, book\.segmentCount\)/);
    assert.match(scan, /bookPlaces\.set\(key, places\);/);
    // An empty table on the book's row keeps meaning "scanned, no headings".
    assert.doesNotMatch(scan, /setBookToc/);
    // The list lands only over the book it was read for.
    assert.match(scan, /shown\.origin === "book" && shown\.url === book\.id/);
  });

  it("shows a place as its words and its percent, the words as text only", () => {
    const dialog = fn("openTocDialog", "closeTocDialog");
    assert.match(dialog, /if \(isPlace\(entry\)\) \{/);
    assert.match(dialog, /row\.setAttribute\("data-place", ""\);/);
    assert.match(dialog, /words\.dir = "auto";\n\s+words\.textContent = entry\.title;/);
    assert.match(dialog, /percent\.textContent = t\("reader_percent", entry\.percent\.toLocaleString\(\)\);/);
    assert.doesNotMatch(dialog, /innerHTML/);
    assert.match(css, /\.toc-rows button\[data-place\] \{\n  display: flex;\n  align-items: baseline;/);
    assert.match(css, /\.toc-percent \{\n  flex: none;\n  color: var\(--page-muted\);/);
  });

  it("keeps places out of the search's headings - they are no chapters", () => {
    assert.match(script, /toc: \(\) => docToc\.filter\(\(entry\) => !isPlace\(entry\)\),/);
  });
});
