import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Segment } from "../src/lib/store/saved-article.js";
import { PAGE_SIZE, libraryView, searchableArticle } from "../src/reader/list-view.js";

/**
 * @typedef {import("../src/lib/store/saved-article.js").SavedMeta &
 *   { lastReadAt?: number | null }} ListedMeta
 */

/**
 * @param {number} at
 * @param {Partial<ListedMeta>} [rest]
 * @returns {ListedMeta}
 */
function meta(at, rest = {}) {
  return {
    url: `https://example.org/article/${at}`,
    hostname: "example.org",
    title: `Article ${at}`,
    savedAt: at,
    readAt: null,
    ...rest,
  };
}

describe("searchableArticle", () => {
  it("finds a row by its title and by the site it came from", () => {
    const searchable = searchableArticle(meta(1, { title: "Old Chinese", hostname: "en.wikipedia.org" }));
    for (const word of ["old", "chinese", "wikipedia"]) {
      assert.ok(searchable.includes(word), `misses ${word}`);
    }
  });
});

describe("libraryView", () => {
  it("shows the segment asked for, most recent activity first", () => {
    const metas = [meta(1), meta(2, { readAt: 9 }), meta(3)];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.deepEqual(unread.rows.map((one) => one.savedAt), [3, 1]);
    assert.deepEqual([unread.matching, unread.inSegment], [2, 2]);

    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual(read.rows.map((one) => one.savedAt), [2]);
  });

  it("raises the row read last above rows saved after it, in both segments", () => {
    const metas = [
      meta(1, { lastReadAt: 50 }),
      meta(2),
      meta(3),
      meta(4, { readAt: 9, lastReadAt: 40 }),
      meta(5, { readAt: 9 }),
    ];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.deepEqual(unread.rows.map((one) => one.savedAt), [1, 3, 2]);

    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual(read.rows.map((one) => one.savedAt), [4, 5]);
  });

  it("cuts a long segment into pages and says how many there are", () => {
    const metas = Array.from({ length: 120 }, (_, at) => meta(at));

    const first = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    assert.equal(first.rows.length, PAGE_SIZE);
    assert.equal(first.rows[0]?.savedAt, 119);
    assert.deepEqual([first.page, first.pages, first.matching], [1, 3, 120]);

    const third = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 3 });
    assert.equal(third.rows.length, 120 - 2 * PAGE_SIZE);
    assert.equal(third.rows[0]?.savedAt, 119 - 2 * PAGE_SIZE);
  });

  it("turns pages without losing a row at the seams", () => {
    const metas = Array.from({ length: 120 }, (_, at) => meta(at));

    const first = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    const second = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 2 });
    assert.equal(second.rows[0]?.savedAt, (first.rows.at(-1)?.savedAt ?? 0) - 1);
  });

  it("clamps a page the list no longer reaches, instead of showing a blank one", () => {
    // A delete takes the last row of the last page; a filter narrows pages
    // away. Either way the reader must land on a page that exists.
    const metas = Array.from({ length: PAGE_SIZE + 10 }, (_, at) => meta(at));

    assert.equal(libraryView(metas, { segment: Segment.UNREAD, query: "", page: 9 }).page, 2);
    assert.equal(libraryView(metas, { segment: Segment.UNREAD, query: "", page: 0 }).page, 1);
  });

  it("has one page to offer even when it is empty", () => {
    const view = libraryView([], { segment: Segment.UNREAD, query: "", page: 3 });
    assert.deepEqual([view.page, view.pages, view.matching, view.inSegment], [1, 1, 0, 0]);
    assert.deepEqual(view.rows, []);
  });

  it("filters by title and by site, whichever the reader remembers", () => {
    const metas = [
      meta(1, { title: "Old Chinese" }),
      meta(2, { title: "Grand Tour", hostname: "cycling.example" }),
      meta(3, { title: "Varieties of Chinese" }),
    ];

    const byTitle = libraryView(metas, { segment: Segment.UNREAD, query: "CHINESE", page: 1 });
    assert.deepEqual(byTitle.rows.map((one) => one.savedAt), [3, 1]);

    const bySite = libraryView(metas, { segment: Segment.UNREAD, query: "cycling", page: 1 });
    assert.deepEqual(bySite.rows.map((one) => one.savedAt), [2]);
  });

  it("needs every word of the query somewhere in the row", () => {
    const metas = [meta(1, { title: "Old Chinese" }), meta(2, { title: "Varieties of Chinese" })];

    const view = libraryView(metas, { segment: Segment.UNREAD, query: "old chinese", page: 1 });
    assert.deepEqual(view.rows.map((one) => one.savedAt), [1]);
  });

  it("searches only the segment on screen", () => {
    const metas = [meta(1, { title: "Old Chinese", readAt: 9 }), meta(2, { title: "Grand Tour" })];

    const view = libraryView(metas, { segment: Segment.UNREAD, query: "chinese", page: 1 });
    assert.deepEqual([view.matching, view.inSegment], [0, 1]);
  });

  it("tells a filtered-out list from an empty segment", () => {
    // Two different sentences on screen hang on this: "no match" needs
    // `inSegment` to stay above zero when only the filter emptied the rows.
    const view = libraryView([meta(1)], { segment: Segment.UNREAD, query: "nothing like this", page: 1 });
    assert.deepEqual([view.matching, view.inSegment], [0, 1]);
    assert.deepEqual(view.rows, []);
  });

  it("counts both whole segments for the tabs, whichever one is showing", () => {
    const metas = [meta(1), meta(2, { readAt: 9 }), meta(3), meta(4, { readAt: 9 })];

    const unread = libraryView(metas, { segment: Segment.UNREAD, query: "", page: 1 });
    const read = libraryView(metas, { segment: Segment.READ, query: "", page: 1 });
    assert.deepEqual([unread.unread, unread.read], [2, 2]);
    assert.deepEqual([read.unread, read.read], [2, 2]);
  });

  it("keeps the tab counts whole under a filter and across pages", () => {
    // The tab labels wear these numbers: a filter or a turned page narrows
    // the rows on screen, never what the tabs say they hold.
    const metas = Array.from({ length: PAGE_SIZE + 10 }, (_, at) =>
      meta(at, at % 2 === 0 ? { readAt: 9 } : {}),
    );

    const filtered = libraryView(metas, { segment: Segment.UNREAD, query: "article 1", page: 2 });
    assert.ok(filtered.matching < filtered.inSegment);
    assert.deepEqual([filtered.unread, filtered.read], [PAGE_SIZE / 2 + 5, PAGE_SIZE / 2 + 5]);
  });
});
