import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

import { READER_DEFAULTS, isAlign, isHyphens, isLineHeight, isParagraphs } from "../src/lib/config.js";

/**
 * The typography rows of the Aa panel (D225): line spacing, alignment,
 * hyphenation and paragraphs. The config's rules have their tests in
 * `config.test.js`; this reads the places they meet - the panel's markup,
 * the stamps the reader page puts on its root, the press that writes them,
 * and the stylesheet with a rule under every name but the defaults -
 * because a name with no rule under it is a button that does nothing, and
 * no unit test catches that by asking a function.
 */

const ROOT = new URL("../", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/** The four rows, each with its root attribute, its button attribute and its names. */
const ROWS = [
  { key: "lineHeight", root: "data-reader-line-height", button: "data-line-height", names: ["tight", "normal", "loose"], accepts: isLineHeight },
  { key: "align", root: "data-reader-align", button: "data-align", names: ["left", "justify"], accepts: isAlign },
  { key: "hyphens", root: "data-reader-hyphens", button: "data-hyphens", names: ["none", "auto"], accepts: isHyphens },
  { key: "paragraphs", root: "data-reader-paragraphs", button: "data-paragraphs", names: ["spaced", "indented", "both"], accepts: isParagraphs },
];

describe("the typography rows (D225) - the panel", () => {
  it("has a button for every name of every row, between Width and Links", async () => {
    const html = await source("src/reader/reader.html");
    const width = html.indexOf('data-i18n="reader_width"');
    const links = html.indexOf('data-i18n="reader_links"');
    assert.ok(width !== -1 && links > width, "the Width and Links rows are not where they were");
    for (const row of ROWS) {
      for (const name of row.names) {
        const button = `<button type="button" ${row.button}="${name}" data-i18n="reader_${row.key === "lineHeight" ? "line_height" : row.key}_${name}">`;
        const at = html.indexOf(button);
        assert.ok(at !== -1, `no button for ${row.key} = ${name}`);
        assert.ok(at > width && at < links, `the ${row.key} row does not stand between Width and Links`);
        assert.ok(row.accepts(name), `the guard refuses the panel's own name ${row.key} = ${name}`);
      }
    }
  });

  it("names every row and every choice in all six catalogues", async () => {
    const keys = ["reader_line_height", "reader_align", "reader_hyphens", "reader_paragraphs"];
    for (const row of ROWS) {
      const stem = row.key === "lineHeight" ? "line_height" : row.key;
      for (const name of row.names) keys.push(`reader_${stem}_${name}`);
    }
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`src/_locales/${locale}/messages.json`));
      for (const key of keys) {
        assert.equal(typeof catalogue[key]?.message, "string", `${locale} has no ${key}`);
        assert.ok(catalogue[key].message.length > 0, `${locale}: ${key} is empty`);
      }
    }
  });
});

describe("the typography rows (D225) - the reader page", () => {
  it("stamps each row on the root and lights the pressed button from the same name", async () => {
    const page = await source("src/reader/reader.js");
    const apply = bodyOf(page, "applyAppearance");
    assert.match(apply, /root\.dataset\["readerLineHeight"\] = reader\.lineHeight;/, "the leading is not stamped");
    assert.match(apply, /root\.dataset\["readerAlign"\] = reader\.align;/, "the alignment is not stamped");
    assert.match(apply, /root\.dataset\["readerHyphens"\] = reader\.hyphens;/, "hyphenation is not stamped");
    assert.match(apply, /root\.dataset\["readerParagraphs"\] = reader\.paragraphs;/, "the paragraphs are not stamped");
    for (const row of ROWS) {
      assert.match(apply, new RegExp(`\\["${row.button}", reader\\.${row.key}\\]`), `the ${row.key} row's buttons never light`);
    }
  });

  it("writes a press on a row's button through the config's own guard, one row at a time", async () => {
    const press = bodyOf(await source("src/reader/reader.js"), "onDisplayPress");
    assert.match(press, /const lineHeight = button\.getAttribute\("data-line-height"\);/);
    assert.match(press, /else if \(isLineHeight\(lineHeight\)\) patch = \{ lineHeight \};/, "a leading press is not written");
    assert.match(press, /else if \(isAlign\(align\)\) patch = \{ align \};/, "an alignment press is not written");
    assert.match(press, /else if \(isHyphens\(hyphens\)\) patch = \{ hyphens \};/, "a hyphenation press is not written");
    assert.match(press, /else if \(isParagraphs\(paragraphs\)\) patch = \{ paragraphs \};/, "a paragraphs press is not written");
  });

  it("keeps the rows off the shared appearance module - they are the article's alone", async () => {
    const shared = await source("src/lib/appearance.js");
    for (const row of ROWS) {
      assert.doesNotMatch(shared, new RegExp(row.root.replace(/-/g, "")), `${row.key} leaked into the shared module`);
      assert.doesNotMatch(shared, /readerLineHeight|readerAlign|readerHyphens|readerParagraphs/);
    }
  });
});

describe("the typography rows (D225) - the stylesheet", () => {
  it("has a rule under every name but the default, and none under the default", async () => {
    const css = await source("src/reader/reader.css");
    for (const row of ROWS) {
      const fallback = READER_DEFAULTS[/** @type {"lineHeight" | "align" | "hyphens" | "paragraphs"} */ (row.key)];
      for (const name of row.names) {
        const selector = `:root[${row.root}="${name}"]`;
        if (name === fallback) {
          // The default is the article as it was drawn before the row
          // existed: a rule under it would move every profile that never
          // touched the row.
          assert.doesNotMatch(css, new RegExp(selector.replace(/[[\]]/g, "\\$&")), `a rule stands under the default ${row.key} = ${name}`);
        } else {
          assert.ok(css.includes(selector), `no rule dresses ${row.key} = ${name}`);
        }
      }
    }
  });

  it("hyphenates only an article that declares its language, and never code", async () => {
    const css = await source("src/reader/reader.css");
    // Without the attribute the property would inherit the page's own
    // `lang="en"` and break a Polish text by English rules.
    assert.match(css, /:root\[data-reader-hyphens="auto"\] #article\[lang\] #content :is\(p, li, dd, blockquote, figcaption\) \{\s*hyphens: auto;/);
    assert.match(css, /:root\[data-reader-hyphens="auto"\] #content :is\(code, kbd, samp, pre\) \{\s*hyphens: manual;/);
    assert.doesNotMatch(css, /:root\[data-reader-hyphens="auto"\] #article \{/, "hyphenation reaches an article with no language");
  });

  it("indents every paragraph of prose but the one opening a section, and closes the gap in the indented mode alone", async () => {
    const css = await source("src/reader/reader.css");
    // Every paragraph, not "a paragraph another one follows": a page's
    // paragraphs come grouped in wrapper divs the sanitizer keeps, and the
    // first of each group stood flush with a gap over it (Michał's smoke,
    // 2026-09-15). Lists and table cells are not prose.
    const prose = String.raw`#content p:not\(:is\(li, td, th\) p\)`;
    const opening = String.raw`#content :is\(h1, h2, h3, h4, h5, h6, hr\) \+ p`;
    assert.match(css, new RegExp(String.raw`:root\[data-reader-paragraphs="indented"\] ${prose},\s*:root\[data-reader-paragraphs="both"\] ${prose} \{\s*text-indent: 1\.5em;`));
    assert.match(css, new RegExp(String.raw`:root\[data-reader-paragraphs="indented"\] ${opening},\s*:root\[data-reader-paragraphs="both"\] ${opening} \{\s*text-indent: 0;`));
    assert.match(css, new RegExp(String.raw`:root\[data-reader-paragraphs="indented"\] ${prose} \{\s*margin-bottom: 0;`));
    // The air a paragraph no longer leaves under itself comes back from the
    // blocks that are not paragraphs, so a list or a picture keeps its room.
    assert.match(css, /:root\[data-reader-paragraphs="indented"\] #content :is\(ul, ol, dl, table, figure, blockquote, pre\),\s*:root\[data-reader-paragraphs="indented"\] #content p \+ img \{\s*margin-top: 1\.2rem;/);
    // `both` keeps the web's blank line: nothing about margins under it.
    assert.doesNotMatch(css, /:root\[data-reader-paragraphs="both"\][^{]*\{\s*margin/);
    assert.doesNotMatch(css, /p:has\(\+ p\)/, "the first cut's sibling rule is back");
  });

  it("justifies the prose and leaves headings, captions and cells ragged", async () => {
    const css = await source("src/reader/reader.css");
    assert.match(css, /:root\[data-reader-align="justify"\] #content :is\(p, li, dd\) \{\s*text-align: justify;/);
    assert.doesNotMatch(css, /:root\[data-reader-align="justify"\] #(article|content) \{/);
  });

  it("says the chosen word with the bar's wash, in both homes of the panel, and leaves the swatches their ring", async () => {
    // The accent alone - on the frame and on the word - is the resting
    // frame's grey on an e-ink panel (Michał's Boox, 2026-09-15); the
    // bar's quarter-accent wash is the cut that survived its sixteen greys.
    const wash = String.raw`border-color: var\(--page-accent\);\s*background: color-mix\(in srgb, var\(--page-accent\) 25%, transparent\);\s*color: var\(--page-fg\);`;
    const reader = await source("src/reader/reader.css");
    assert.match(reader, new RegExp(String.raw`\.reader-choices button\[aria-pressed="true"\] \{\s*${wash}`));
    assert.match(reader, /#marker-color-choices button\[aria-pressed="true"\],\s*#underline-choices button\[aria-pressed="true"\],\s*\.mark-inks button\[aria-pressed="true"\] \{\s*box-shadow: 0 0 0 2px var\(--page-accent\);[^}]*background: transparent;/, "a wash sits around a drawn ink");
    const phrases = await source("src/vocab/vocab.css");
    assert.match(phrases, new RegExp(String.raw`\.page-choices button\[aria-pressed="true"\] \{\s*${wash}`), "the phrases page's panel says it another way");
  });

  it("gives the list's tabs, the article's held pills and the phrases page's shelves the same quarter of the accent", async () => {
    // Every pressed state on the pages says it with one wash (Michał's
    // ask after the panel, 2026-09-15): 12% was paper on the Boox.
    const quarter = /background: color-mix\(in srgb, var\(--page-accent\) 25%, transparent\);/;
    const reader = await source("src/reader/reader.css");
    assert.match(reader, new RegExp(String.raw`\.library-segments button\[aria-pressed="true"\] \{\s*border-color: var\(--page-accent\);\s*${quarter.source}`), "the tab in view is back to 12%");
    assert.match(reader, new RegExp(String.raw`\.article-actions button\[aria-pressed="true"\] \{\s*border-color: var\(--page-accent\);\s*${quarter.source}`), "the held pill is back to 12%");
    const phrases = await source("src/vocab/vocab.css");
    assert.match(phrases, new RegExp(String.raw`\.phrase-segments button\[aria-pressed="true"\] \{\s*border-color: var\(--page-accent\);\s*${quarter.source}`), "the shelf in view is back to 12%");
  });

  it("lets the panel scroll within itself where the rows outgrow the window", async () => {
    const css = await source("src/reader/reader.css");
    assert.match(css, /\.reader-panel \{[^}]*max-height: calc\(100dvh - var\(--header-h\) - 1rem\);\s*overflow-y: auto;\s*overscroll-behavior: contain;/);
  });
});

describe("the typography rows (D225) - the promises", () => {
  it("are named in the README and the hyphenation in PRIVACY", async () => {
    const readme = await source("README.md");
    assert.match(readme, /line spacing, left-aligned or justified lines, hyphenation/);
    assert.match(readme, /a page that declares no language is not hyphenated/);
    const privacy = await source("PRIVACY.md");
    assert.match(privacy, /^## Hyphenation$/m);
    assert.match(privacy, /hyphenation_component_installer\.cc/);
    assert.match(privacy, /nsHyphenationManager\.cpp/);
  });
});
