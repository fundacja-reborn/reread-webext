import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGE_HTML } from "../src/lib/protocol.js";
import {
  ARTICLES_FILENAME,
  fromArticlesFile,
  importPlan,
  toArticlesFile,
} from "../src/lib/store/articles-file.js";
import { savedArticle } from "../src/lib/store/saved-article.js";

/**
 * @param {string} path
 * @param {Partial<Parameters<typeof savedArticle>[0]> & { readAt?: number | null }} [overrides]
 * @returns {import("../src/lib/store/saved-article.js").SavedArticle}
 */
function article(path, overrides = {}) {
  const { readAt = null, ...rest } = overrides;
  const built = savedArticle({
    url: `https://example.com/${path}`,
    title: `Title of ${path}`,
    content: `<p>Body of ${path}</p>`,
    savedAt: 1000,
    ...rest,
  });
  assert.ok(built !== null);
  return { ...built, readAt };
}

describe("toArticlesFile", () => {
  it("writes a file the reader gets back article for article", () => {
    const kept = [
      article("one", { dir: "rtl", lang: "ar" }),
      article("two", { savedAt: 2000, readAt: 2500 }),
    ];
    const parsed = fromArticlesFile(toArticlesFile(kept));
    assert.equal(parsed.invalid, 0);
    assert.deepEqual(parsed.articles, kept);
  });

  it("writes oldest saved first, address as the tie, whatever order it was given", () => {
    const file = toArticlesFile([
      article("late", { savedAt: 3000 }),
      article("b-early", { savedAt: 1000 }),
      article("a-early", { savedAt: 1000 }),
    ]);
    const urls = fromArticlesFile(file).articles.map((one) => one.url);
    assert.deepEqual(urls, [
      "https://example.com/a-early",
      "https://example.com/b-early",
      "https://example.com/late",
    ]);
  });

  it("does not carry the hostname - import derives it the way saving does", () => {
    assert.ok(!toArticlesFile([article("one")]).includes("hostname"));
  });

  it("ends with a newline and names its format", () => {
    const file = toArticlesFile([]);
    assert.ok(file.endsWith("\n"));
    assert.equal(JSON.parse(file).format, "reread-articles");
  });
});

describe("fromArticlesFile", () => {
  it("holds zero articles when the file is not ours at all", () => {
    assert.deepEqual(fromArticlesFile("not json"), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile("[]"), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile('{"articles":[]}'), { articles: [], invalid: 0 });
    assert.deepEqual(fromArticlesFile('{"format":"reread-vocab","articles":[]}'), {
      articles: [],
      invalid: 0,
    });
  });

  it("counts a broken entry between good ones rather than dropping the file", () => {
    const file = JSON.stringify({
      format: "reread-articles",
      version: 1,
      articles: [
        { url: "https://example.com/good", title: "Good", content: "<p>x</p>", savedAt: 1 },
        { url: "not a url", title: "Bad address", content: "<p>x</p>", savedAt: 1 },
        { url: "https://example.com/empty", title: "No content", content: "", savedAt: 1 },
        { url: "https://example.com/when", title: "No date", content: "<p>x</p>" },
        "not an entry",
      ],
    });
    const parsed = fromArticlesFile(file);
    assert.equal(parsed.invalid, 4);
    assert.deepEqual(
      parsed.articles.map((one) => one.url),
      ["https://example.com/good"],
    );
  });

  it("derives hostname and title fresh rather than believing the file", () => {
    const file = JSON.stringify({
      format: "reread-articles",
      version: 1,
      articles: [
        { url: "https://example.com/a", title: "  ", content: "<p>x</p>", savedAt: 1, hostname: "evil.example" },
      ],
    });
    const [one] = fromArticlesFile(file).articles;
    assert.equal(one?.hostname, "example.com");
    assert.equal(one?.title, "example.com");
  });

  it("keeps a readable read mark and reads anything else as unread", () => {
    const rows = [
      { url: "https://example.com/read", title: "t", content: "<p>x</p>", savedAt: 1, readAt: 42 },
      { url: "https://example.com/unread", title: "t", content: "<p>x</p>", savedAt: 1, readAt: "yes" },
      { url: "https://example.com/silent", title: "t", content: "<p>x</p>", savedAt: 1 },
    ];
    const parsed = fromArticlesFile(JSON.stringify({ format: "reread-articles", articles: rows }));
    assert.deepEqual(
      parsed.articles.map((one) => one.readAt),
      [42, null, null],
    );
  });

  it("refuses an entry bigger than the biggest page the reader can be handed", () => {
    const rows = [
      {
        url: "https://example.com/huge",
        title: "t",
        content: "x".repeat(MAX_PAGE_HTML + 1),
        savedAt: 1,
      },
    ];
    const parsed = fromArticlesFile(JSON.stringify({ format: "reread-articles", articles: rows }));
    assert.equal(parsed.articles.length, 0);
    assert.equal(parsed.invalid, 1);
  });
});

describe("importPlan", () => {
  it("adds what the list is missing and skips what it already holds", () => {
    const held = article("held");
    const missing = article("missing");
    const plan = importPlan([held.url], [held, missing]);
    assert.deepEqual(plan.toAdd, [missing]);
    assert.equal(plan.skipped, 1);
  });

  it("adds a twice-named address once, the first winning", () => {
    const first = article("twice", { title: "First" });
    const second = article("twice", { title: "Second" });
    const plan = importPlan([], [first, second]);
    assert.deepEqual(plan.toAdd, [first]);
    assert.equal(plan.skipped, 1);
  });

  it("adds nothing the second time - importing the same file twice is safe", () => {
    const file = [article("one"), article("two")];
    const first = importPlan([], file);
    assert.equal(first.toAdd.length, 2);

    const existing = first.toAdd.map((one) => one.url);
    const second = importPlan(existing, file);
    assert.deepEqual(second, { toAdd: [], skipped: 2 });
  });
});

describe("the exported file's name", () => {
  it("is one name - the list is one list", () => {
    assert.equal(ARTICLES_FILENAME, "reread-articles.json");
  });
});
