import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { sourceOf, webAddress } from "../src/lib/reader/source.js";

/**
 * The site under the title (D232): the one door to the original page a
 * reader who never opens the menu meets, and the rule behind it - the
 * same rule the menu's row and the orphan quotes' door (D150) go by. The
 * rule is asked directly; the rest reads the places the line meets the
 * page - its markup between the byline and the facts line, the stylesheet
 * that closes the block up around it, the script that fills it and the
 * gesture hook that keeps a hold on the link from becoming a word to
 * select - for the reason the facts line's tests do (`reader-facts.test.js`):
 * a line nobody draws is a feature that silently does nothing.
 */

const ROOT = new URL("../", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the site under the title (D232) - the rule", () => {
  it("names the host of a web address, as the list row does", () => {
    assert.deepEqual(sourceOf("https://ssd.eff.org/module/deep-dive-end-end-encryption"), {
      host: "ssd.eff.org",
      href: "https://ssd.eff.org/module/deep-dive-end-end-encryption",
    });
    assert.deepEqual(sourceOf("http://example.com/"), { host: "example.com", href: "http://example.com/" });
  });

  it("keeps the host as the row stores it: www. and all, no port, an international name in its wire form", () => {
    assert.equal(sourceOf("https://www.theguardian.com/world/article")?.host, "www.theguardian.com");
    assert.equal(sourceOf("http://localhost:8080/page")?.host, "localhost");
    // `savedArticle` derives the row's hostname from the same parser, so the
    // line and the row can only ever name one site the same way.
    const international = "https://münchen.example/stadt";
    assert.equal(sourceOf(international)?.host, new URL(international).hostname);
  });

  it("hands the address back unchanged, the way the menu's row carries it", () => {
    const address = "https://example.org/a%20b/?q=1&r=2#part";
    assert.equal(sourceOf(address)?.href, address);
  });

  it("has nothing to say over a book, a file page, or what is no address at all", () => {
    assert.equal(sourceOf(null), null);
    // A book's id (`crypto.randomUUID()` at import) is no address.
    assert.equal(sourceOf("0f1a2b3c-4d5e-4f60-8172-8394a5b6c7d8"), null);
    assert.equal(sourceOf("file:///Users/reader/article.html"), null);
    assert.equal(sourceOf("about:blank"), null);
    assert.equal(sourceOf("javascript:alert(1)"), null);
    assert.equal(sourceOf("moz-extension://0f1a2b3c/reader/reader.html"), null);
    assert.equal(sourceOf("not an address"), null);
    assert.equal(sourceOf(""), null);
  });

  it("is the one rule the menu's row and the orphan quotes' door go by", () => {
    assert.equal(webAddress("https://example.org/"), true);
    assert.equal(webAddress("http://example.org/"), true);
    assert.equal(webAddress("file:///tmp/page.html"), false);
    assert.equal(webAddress("ftp://example.org/"), false);
    assert.equal(webAddress("not an address"), false);
  });
});

describe("the site under the title (D232) - the page", () => {
  it("stands between the byline and the facts line, hidden until there is a site to name", async () => {
    const html = await source("src/reader/reader.html");
    const byline = html.indexOf('<p id="byline" class="reader-byline" hidden></p>');
    const line = html.indexOf('<p id="source" class="reader-source" hidden>');
    const facts = html.indexOf('<p id="facts" class="reader-facts" hidden></p>');
    assert.ok(byline !== -1 && facts !== -1, "the byline or the facts line is not where it was");
    assert.ok(line > byline && line < facts, "the site does not stand between the byline and the facts line");
    assert.match(
      html,
      /<a id="source-link" title="Open the original" data-i18n-title="reader_open_original">\s*<span id="source-site"><\/span>\s*<svg class="reader-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">/,
      "the link, its name and its arrow are not as drawn",
    );
    // The markup carries no address: the script fills one in over a web
    // address only, and the name is text, never markup.
    assert.doesNotMatch(html, /<a id="source-link"[^>]*\shref=/, "the link has an address of its own");
  });

  it("is dressed like the byline, and the block closes up around it", async () => {
    const css = await source("src/reader/reader.css");
    assert.match(css, /\.reader-byline,\s*\.reader-source,\s*\.reader-facts,\s*\.reader-pictures\s*\{/);
    assert.match(css, /\.reader-byline:has\(~ :is\(\.reader-source, \.reader-facts, \.reader-pictures\):not\(\[hidden\]\)\)/);
    assert.match(css, /\.reader-source:has\(~ :is\(\.reader-facts, \.reader-pictures\):not\(\[hidden\]\)\)/);
    assert.match(css, /\.reader-source\[hidden\]\s*\{\s*display: none;/, "a flex row that does not hide");
    assert.match(css, /\.reader-source a \{[^}]*min-height: 44px;/, "the link has no touch target");
  });

  it("is filled by the rule the menu's row goes by, opens the page in a new tab, and is the reader's to press", async () => {
    const reader = await source("src/reader/reader.js");
    assert.match(reader, /const from = sourceOf\(piece\.link\);/, "the line does not ask the rule");
    assert.match(reader, /originalLink\.href = from\.href;/, "the menu's row goes by another rule");
    assert.match(
      reader,
      /sourceSite\.textContent = from\.host;\s*sourceLink\.href = from\.href;\s*sourceLink\.target = "_blank";\s*sourceLink\.rel = "noreferrer noopener";/,
      "the link is not filled as the menu's row is",
    );
    assert.match(reader, /if \(from === null\) \{\s*sourceLine\.hidden = true;/, "a book would keep the last article's site");
    assert.doesNotMatch(reader, /^function webAddress\(/m, "the reader keeps a rule of its own");
    assert.match(reader, /sourceLine\?\.contains\(target\) === true/, "a hold on the link would select a word");
  });
});
