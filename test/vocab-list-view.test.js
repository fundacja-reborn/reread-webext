import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PAGE_SIZE,
  listView,
  markSegments,
  newestFirst,
  pairChoicesFor,
  searchablePhrase,
} from "../src/vocab/list-view.js";

/**
 * @param {number} at
 * @param {Partial<import("../src/lib/store/phrase.js").Phrase>} [rest]
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(at, rest = {}) {
  return {
    id: `id-${String(at).padStart(4, "0")}`,
    langFrom: "en",
    langTo: "pl",
    phrase: `word${at}`,
    normalized: `word${at}`,
    translations: [`meaning${at}`],
    createdAt: at,
    ...rest,
  };
}

describe("newestFirst", () => {
  it("turns the store's oldest-first into newest-first", () => {
    const sorted = newestFirst([phrase(1), phrase(2), phrase(3)]);
    assert.deepEqual(sorted.map((one) => one.createdAt), [3, 2, 1]);
  });

  it("holds the order of two phrases saved in the same millisecond", () => {
    const twins = [phrase(5, { id: "id-a" }), phrase(5, { id: "id-b" })];
    assert.deepEqual(newestFirst(twins).map((one) => one.id), ["id-b", "id-a"]);
    assert.deepEqual(newestFirst([...twins].reverse()).map((one) => one.id), ["id-b", "id-a"]);
  });

  it("answers a copy rather than reordering the caller's list", () => {
    const kept = [phrase(1), phrase(2)];
    newestFirst(kept);
    assert.deepEqual(kept.map((one) => one.createdAt), [1, 2]);
  });
});

describe("searchablePhrase", () => {
  it("finds a phrase by how it is written and by every meaning", () => {
    const searchable = searchablePhrase(phrase(1, { phrase: "Bank", translations: ["brzeg", "instytucja"] }));
    for (const word of ["bank", "brzeg", "instytucja"]) {
      assert.ok(searchable.includes(word), `misses ${word}`);
    }
  });
});

describe("listView", () => {
  it("shows the first hundred of a long list, and says how long it is", () => {
    const view = listView(Array.from({ length: 250 }, (_, at) => phrase(at)), { query: "", page: 1 });

    assert.equal(view.rows.length, PAGE_SIZE);
    assert.equal(view.rows[0]?.createdAt, 0);
    assert.deepEqual([view.page, view.pages, view.matching], [1, 3, 250]);
  });

  it("turns pages without losing a row at the seams", () => {
    const phrases = Array.from({ length: 250 }, (_, at) => phrase(at));

    const second = listView(phrases, { query: "", page: 2 });
    const third = listView(phrases, { query: "", page: 3 });

    assert.equal(second.rows[0]?.createdAt, 100);
    assert.equal(second.rows.length, PAGE_SIZE);
    assert.equal(third.rows[0]?.createdAt, 200);
    assert.equal(third.rows.length, 50);
  });

  it("clamps a page the list no longer reaches, instead of showing a blank one", () => {
    // Learned takes the last row of the last page; a filter narrows ten pages
    // to one. Either way the reader must land on a page that exists.
    const phrases = Array.from({ length: 150 }, (_, at) => phrase(at));

    assert.equal(listView(phrases, { query: "", page: 9 }).page, 2);
    assert.equal(listView(phrases, { query: "", page: 0 }).page, 1);
  });

  it("has one page to offer even when it is empty", () => {
    const view = listView([], { query: "", page: 3 });
    assert.deepEqual([view.page, view.pages, view.matching], [1, 1, 0]);
    assert.deepEqual(view.rows, []);
  });

  it("filters by phrase and by meaning, whichever the reader remembers", () => {
    const phrases = [
      phrase(1, { phrase: "bank", translations: ["brzeg"] }),
      phrase(2, { phrase: "shore", translations: ["brzeg", "wybrzeże"] }),
      phrase(3, { phrase: "watch", translations: ["zegarek"] }),
    ];

    assert.deepEqual(
      listView(phrases, { query: "brzeg", page: 1 }).rows.map((one) => one.phrase),
      ["bank", "shore"],
    );
    assert.deepEqual(
      listView(phrases, { query: "WATCH", page: 1 }).rows.map((one) => one.phrase),
      ["watch"],
    );
  });

  it("needs every word of the query somewhere in the row", () => {
    const phrases = [
      phrase(1, { phrase: "bank", translations: ["brzeg"] }),
      phrase(2, { phrase: "bank holiday", translations: ["dzień wolny"] }),
    ];

    assert.deepEqual(
      listView(phrases, { query: "bank brzeg", page: 1 }).rows.map((one) => one.phrase),
      ["bank"],
    );
  });

  it("says when nothing matches, with a page to stand on", () => {
    const view = listView([phrase(1)], { query: "nothing like this", page: 1 });
    assert.deepEqual([view.matching, view.pages, view.page], [0, 1, 1]);
  });
});

describe("markSegments", () => {
  it("hands the text back whole when there is no query", () => {
    assert.deepEqual(markSegments("bank holiday", ""), [{ text: "bank holiday", hit: false }]);
    assert.deepEqual(markSegments("bank holiday", "   "), [{ text: "bank holiday", hit: false }]);
  });

  it("marks every occurrence of every word, case-folded", () => {
    assert.deepEqual(markSegments("Bank am Bankufer", "bank"), [
      { text: "Bank", hit: true },
      { text: " am ", hit: false },
      { text: "Bank", hit: true },
      { text: "ufer", hit: false },
    ]);
  });

  it("merges overlapping words into one marked stretch", () => {
    assert.deepEqual(markSegments("abc", "ab bc"), [{ text: "abc", hit: true }]);
  });

  it("always hands back the text it was given, in order", () => {
    const text = "der Bankangestellte an der Bank";
    const joined = markSegments(text, "bank an").map((segment) => segment.text).join("");
    assert.equal(joined, text);
  });

  it("marks nothing rather than marking wrong when folding shifts letters", () => {
    // One dotted capital I becomes two code units in lower case; the folded
    // indexes then stop pointing into the original.
    assert.equal("İstanbul".toLowerCase().length, "İstanbul".length + 1);
    assert.deepEqual(markSegments("İstanbul", "istanbul"), [{ text: "İstanbul", hit: false }]);
  });
});

describe("pairChoicesFor", () => {
  const READING = { sourceLang: "en", targetLang: "pl" };

  it("offers every pair with anything saved, by name, counts along", () => {
    const choices = pairChoicesFor(READING, [
      { langFrom: "pl", langTo: "en", count: 7 },
      { langFrom: "en", langTo: "pl", count: 1243 },
    ]);

    assert.deepEqual(choices, [
      { pair: "enpl", from: "en", to: "pl", count: 1243 },
      { pair: "plen", from: "pl", to: "en", count: 7 },
    ]);
  });

  it("offers the configured pair even when nothing is saved for it", () => {
    // A control must never disagree with the settings it shows - the popup's
    // rule, and this select writes the same settings.
    const choices = pairChoicesFor(READING, [{ langFrom: "de", langTo: "pl", count: 3 }]);

    assert.deepEqual(choices[0], { pair: "enpl", from: "en", to: "pl", count: 0 });
    assert.equal(choices.length, 2);
  });

  it("offers the configured pair alone on a fresh install", () => {
    assert.deepEqual(pairChoicesFor(READING, []), [
      { pair: "enpl", from: "en", to: "pl", count: 0 },
    ]);
  });
});
