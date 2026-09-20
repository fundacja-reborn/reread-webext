import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bookPercent, pageFootCount, pagePercent } from "../src/lib/reader/pages.js";
import { overallPercent } from "../src/lib/reader/position.js";

// The foot of a page over a long book (D273). Read by pages, the foot used
// to count the pages of the stretch on screen - "3 / 26" - and start again
// from one at every stretch, which gave away the division D270 stopped
// saying anywhere. Over a book kept in more than one stretch it now says how
// much of the WHOLE book is read, in whole percent (Michał, 2026-09-20: no
// fraction - Kindle and KOReader show a whole number too), and the number
// is the reading list's own, to the rounding.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), "utf8");

describe("bookPercent", () => {
  it("counts the stretches before as read through, and the one on screen by its pages", () => {
    // 63 stretches of 26 pages: the book's first page, its middle, its last.
    assert.equal(bookPercent(0, 63, 0, 26), 0);
    assert.equal(bookPercent(31, 63, 12, 26), 50);
    assert.equal(bookPercent(62, 63, 25, 26), 100);
  });

  it("goes on across the border between two stretches without starting again", () => {
    const last = bookPercent(7, 63, 25, 26);
    const first = bookPercent(8, 63, 0, 26);
    assert.ok(first >= last, `${last}% then ${first}%`);
    assert.ok(first - last <= 1, "one turn of a page moved the number by more than a percent");
  });

  it("never goes down as the pages are turned through the whole book", () => {
    let before = -1;
    for (let index = 0; index < 12; index += 1) {
      for (let page = 0; page < 9; page += 1) {
        const now = bookPercent(index, 12, page, 9);
        assert.ok(now >= before, `stretch ${index}, page ${page}: ${before}% then ${now}%`);
        before = now;
      }
    }
    assert.equal(before, 100);
  });

  it("is the number the reading list shows for the same place, to the rounding", () => {
    // The position row stores `pagePercent` for the stretch on screen; the
    // list makes the whole book's percent of it (`overallPercent`).
    for (const count of [2, 3, 12, 63, 400]) {
      for (const pages of [1, 7, 26, 40]) {
        for (let index = 0; index < count; index += Math.max(1, Math.floor(count / 9))) {
          for (let page = 0; page < pages; page += 1) {
            const listed = overallPercent(
              { docId: "book:eden", segmentIndex: index, blockIndex: 0, updatedAt: 1, percent: pagePercent(page, pages) },
              count,
            );
            assert.equal(bookPercent(index, count, page, pages), listed, `${index}/${count}, page ${page}/${pages}`);
          }
        }
      }
    }
  });

  it("is a whole number inside 0-100 whatever it is handed", () => {
    for (const value of [bookPercent(3, 10, 2, 0), bookPercent(-4, 10, 0, 5), bookPercent(99, 10, 4, 5), bookPercent(2, 10, 50, 5)]) {
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 100, String(value));
    }
    // A book in one stretch is its own whole.
    assert.equal(bookPercent(0, 1, 2, 12), pagePercent(2, 12));
  });
});

describe("pageFootCount", () => {
  it("counts pages wherever the pages are the whole document's", () => {
    assert.deepEqual(pageFootCount({ page: 2, pages: 12, segment: null }), { kind: "pages", page: 3, pages: 12 });
    // A book short enough to be kept in one stretch: "3 / 12" is the truth
    // about the whole of it, and says more than a percent would.
    assert.deepEqual(pageFootCount({ page: 2, pages: 12, segment: { index: 0, count: 1 } }), {
      kind: "pages",
      page: 3,
      pages: 12,
    });
  });

  it("says the whole book's percent over a book kept in more than one stretch", () => {
    assert.deepEqual(pageFootCount({ page: 12, pages: 26, segment: { index: 31, count: 63 } }), {
      kind: "percent",
      percent: 50,
    });
  });
});

describe("the foot of the reader's page over a long book", () => {
  const script = read("src/reader/reader.js");
  const from = script.indexOf("\nfunction refreshCurtain(");
  const curtain = script.slice(from, script.indexOf("\n}\n", from));

  it("asks the rule with the book's place, and nothing for any other document", () => {
    assert.match(curtain, /const counted = pageFootCount\(\{/);
    assert.match(
      curtain,
      /shown !== null && shown\.origin === "book"\n\s+\? \{ index: shown\.segmentIndex, count: shown\.segmentCount \}\n\s+: null,/,
    );
  });

  it("says the percent in all three places the count is said", () => {
    // The foot and the bar share one string; the live region has its own
    // words - "12% of the book" - because a bare number says nothing aloud.
    assert.match(curtain, /counted\.kind === "percent"\n\s+\? t\("reader_percent", counted\.percent\.toLocaleString\(\)\)/);
    assert.match(curtain, /if \(pageFooter\.textContent !== said\) pageFooter\.textContent = said;/);
    assert.match(curtain, /if \(pageCount\.textContent !== said\) pageCount\.textContent = said;/);
    assert.match(curtain, /\? t\("reader_page_book_percent", counted\.percent\.toLocaleString\(\)\)/);
    assert.match(curtain, /: t\("reader_page_of", \[counted\.page\.toLocaleString\(\), counted\.pages\.toLocaleString\(\)\]\);/);
  });

  it("is said in the setting's note, in every language, and in the README", () => {
    const expected = { en: "12%", pl: "12%", de: "12 %", fr: "12 %", es: "12 %", uk: "12%" };
    for (const [lang, example] of Object.entries(expected)) {
      const catalogue = JSON.parse(read(`src/_locales/${lang}/messages.json`));
      const hint = catalogue["options_page_number_hint"]?.message ?? "";
      assert.ok(hint.includes("3 / 12"), `${lang}: the page example is gone`);
      assert.ok(hint.includes(example), `${lang}: no percent example in the catalogue's own spacing`);
      // The bare percent wears the same spacing as the example.
      assert.equal(catalogue["reader_percent"]?.message, example.replace("12", "$PERCENT$"), lang);
    }
    assert.match(read("README.md"), /In a long book the count is how much of the whole book you have read, in whole percent/);
  });
});
