import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Pages as the layout nobody had to choose (D279): the wiring in the reader
 * page - script, stylesheet, markup, catalogues - around the two rules that
 * are tested where they live (`effectiveLayout` in `config.test.js`, the
 * swipe in `reader-pages.test.js`). What a smoke test on glass sees one
 * screen of at a time: that every reader of the layout asks for the one in
 * force, that the word about pages is said until it is answered and never
 * after, and that the finger's drag is left to the page.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The body of one top-level function.
 *
 * @param {string} script
 * @param {string} name
 */
function bodyOf(script, name) {
  const at = script.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.notEqual(at, -1, `no function ${name}`);
  return script.slice(at, script.indexOf("\n}\n", at));
}

describe("pages while nobody has chosen a layout (D279)", () => {
  it("asks for the layout in force wherever the reader reads the layout", async () => {
    const reader = await source("reader/reader.js");
    assert.match(bodyOf(reader, "paged"), /return effectiveLayout\(settings\.reader\) === "paged" &&/, "a profile that never chose scrolls");
    const dress = bodyOf(reader, "applyAppearance");
    assert.match(dress, /const layout = effectiveLayout\(reader\);\s*root\.dataset\["readerLayout"\] = layout;/, "the stylesheet is handed null for a layout");
    assert.match(dress, /\["data-layout", layout\],/, "the Aa panel's row shows nothing pressed while nobody has chosen");
    // Nowhere else: a stored null read as a name would be a bug of the
    // quiet kind - the text scrolling under a row that says Pages.
    assert.equal((reader.match(/reader\.layout\b/g) ?? []).length, 2, "somebody reads the stored layout besides the word about pages");
  });

  it("says the word about pages over a text, once the stored settings are in, and never over another sentence", async () => {
    const reader = await source("reader/reader.js");
    const offer = bodyOf(reader, "offerScrollLayout");
    assert.match(offer, /if \(!settingsAdopted \|\| settings\.reader\.layout !== null\) return;/, "the word is said over defaults, or after an answer");
    assert.match(offer, /if \(article === null \|\| article\.hidden \|\| !notice\.hidden\) return;/, "the word is said over the list, or over a sentence about something that went wrong");
    assert.match(offer, /noticeText\.textContent = t\("reader_layout_notice"\);/);
    assert.match(offer, /const label = t\("reader_layout_scroll"\);/, "the button is not named the way the Aa panel names the layout");
    assert.match(bodyOf(reader, "renderArticle"), /hideNotice\(\);\s*\/\/[^\n]*\n\s*offerScrollLayout\(\);/, "a text stands up without the word it is owed");
  });

  it("takes either answer, stores it the way the Aa panel stores a layout, and says nothing after", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /noticeClose\?\.addEventListener\("click", \(\) => \{\s*const answered = noticeOffer === "layout";\s*hideNotice\(\);\s*if \(answered\) void answerLayout\("paged"\);/, "closing the word does not keep the pages by choice");
    assert.match(reader, /if \(noticeOffer === "layout"\) \{\s*hideNotice\(\);\s*void answerLayout\("scroll"\);\s*return;/, "the button does not go back to scrolling, or arms itself like a Delete");
    assert.match(bodyOf(reader, "answerLayout"), /adoptConfig\(await writeConfig\(\{ reader: \{ layout \} \}\)\);/);
    // A layout chosen in the Aa panel, or in another tab, is an answer too.
    const adopt = bodyOf(reader, "adoptConfig");
    assert.match(adopt, /settingsAdopted = true;\s*if \(noticeOffer === "layout" && config\.reader\.layout !== null\) hideNotice\(\);\s*else offerScrollLayout\(\);/, "the word outlives its answer, or is never said when the text stood up before the settings arrived");
    // Another sentence takes the box, and the offer with it.
    assert.match(bodyOf(reader, "showNotice"), /noticeOffer = null;/, "a sentence about a failed write wears the Scroll button");
    assert.match(bodyOf(reader, "hideNotice"), /noticeOffer = null;/);
  });

  it("leaves the finger's drag to the page, and the first page's head to the reader", async () => {
    const styles = await source("reader/reader.css");
    const at = styles.indexOf('\n:root[data-reader-layout="paged"]:has(body.reader #article:not([hidden])) {');
    assert.notEqual(at, -1, "the paged root has no rule");
    const rule = styles.slice(at, styles.indexOf("\n}", at));
    assert.match(rule, /overflow: hidden;\s*touch-action: pinch-zoom;\s*overscroll-behavior: none;/, "a browser may take the drag for a pan of its own, or reload the reader on a pull");
    // The boxes that scroll sideways within the text keep that and hand the
    // drag up and down over like the text around them.
    assert.match(styles, /\n:root\[data-reader-layout="paged"\] #content :is\(pre, table\) \{\s*touch-action: pan-x pinch-zoom;/, "a drag upward that begins over a table is the browser's, and turns nothing");
    // The scroll layout keeps the finger's scroll: nothing of this outside the paged layout.
    assert.equal((styles.match(/touch-action:/g) ?? []).length, 2, "the finger's drag is taken away somewhere else too");
  });

  it("names the button, the panel's row and the layouts the way each catalogue does", async () => {
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      const word = catalogue["reader_layout_notice"]?.message ?? "";
      for (const key of ["reader_layout_scroll", "reader_layout"]) {
        const name = catalogue[key]?.message ?? "";
        assert.ok(name.length > 0 && word.includes(name), `${lang}: the word about pages does not say "${name}"`);
      }
      const intro = catalogue["options_paged_intro"]?.message ?? "";
      for (const key of ["reader_layout_scroll", "reader_layout_paged"]) {
        const name = catalogue[key]?.message ?? "";
        assert.ok(name.length > 0 && intro.includes(name), `${lang}: the settings' intro does not name ${key}`);
      }
    }
    const en = JSON.parse(await source("_locales/en/messages.json"));
    assert.match(en["options_paged_intro"].message, /Pages is the default/);
    assert.match(en["options_touch_turn_note_swipe"].message, /^Sliding a finger left or up shows the next page, right or down the previous one\./);
    assert.match(en["options_touch_turn_note_zones"].message, /Sliding a finger up or down turns the page too/);
    const markup = await source("options/options.html");
    assert.match(markup, /These work in the reading view when its layout is Pages\. Pages is the default; you choose\s+Pages or Scroll in the Aa panel\./, "the settings page's own words lag behind the catalogue");
  });

  it("is promised in the README: the default, the note and the drag up and down", async () => {
    const readme = await source("../README.md");
    assert.match(readme, /\*\*Pages\*\* is the default: the first time a text is opened, a note at the top says that it is divided into pages and has a \*\*Scroll\*\* button/);
    assert.match(readme, /Sliding a finger up shows the next page too, and down the previous one/);
    assert.match(readme, /a mouse that moves with its button down is selecting text and never turns a page/);
  });
});
