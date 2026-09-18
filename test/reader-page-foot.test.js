import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The page's foot and the anchored re-cut (D238): what a page read by
 * pages keeps under its last line, where the count is said, and the rule
 * that a re-cut never moves the page being read. The arithmetic of the cut
 * lives in `lib/reader/pages.js` and is tested there; what is held here is
 * the wiring in the reader page - markup, stylesheet and the reader's own
 * script - which a smoke test on glass would only see one screen of.
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

describe("the page's foot (D238)", () => {
  it("measures the band under whatever stands lowest - a bar, the foot - and nothing is laid under a bar", async () => {
    const reader = await source("reader/reader.js");
    const band = bodyOf(reader, "readableBand");
    // One list for both layouts: the pages are cut above a bar too, and the
    // page being read keeps its first line through the re-cut (the anchor).
    assert.match(band, /for \(const bar of \[speechBar, markBar, pageFooter\]\)/, "the pages leave a bar out of the band");
    assert.doesNotMatch(band, /bars \?/, "the band still has two ways of counting the foot");
    assert.match(bodyOf(reader, "pageBand"), /readableBand\(barFold\(\)\)/, "the pages measure the band under an open sheet, or without the bars");
  });

  it("cuts the pages again from the page being read, and never under a finger", async () => {
    const reader = await source("reader/reader.js");
    const cut = bodyOf(reader, "pagesNow");
    assert.match(cut, /const anchor = same \? anchorY\(\) : undefined;/, "a re-cut of the same document does not begin from the page being read");
    assert.match(cut, /if \(same && pointerHeld\) \{\s*settleWanted = true;\s*return kept;/, "the pages are cut again under a held pointer");
    // The anchor is a place in the text, kept at every turn and found
    // again after a re-wrap; a bar shortening the band leaves it where it
    // stood, so the window does not move.
    assert.match(bodyOf(reader, "showPageOf"), /pages\.anchor = top;\s*keepPageAnchor\(pages, page\);/, "a turn does not keep the page's first line");
    assert.match(bodyOf(reader, "anchorY"), /lineBoxes\(kept\.block\)\.find/, "the anchor's line is not snapped to the line box the cutter measures");
    // Off its page - the bubble's ride, a re-wrap - the window goes back to
    // the page turned to last, not to whatever page the fold happens to cut.
    assert.match(bodyOf(reader, "pageShown"), /return pageAt\(pages\.tops, pages\.anchor\);/, "the window off its page does not go back to the page turned to last");
    // The lift settles what the hold deferred.
    assert.match(reader, /function onPointerLift\(\) \{[\s\S]*?if \(!pointerHeld\) return;\s*pointerHeld = false;\s*if \(!settleWanted\) return;\s*settleWanted = false;\s*settlePage\(\);/, "a settle deferred under the finger is lost on the lift");
    assert.match(bodyOf(reader, "settlePage"), /if \(pointerHeld\) \{\s*settleWanted = true;\s*return;/, "the page settles under a finger");
  });

  it("says the count at the foot only with the setting, in the bar while the foot keeps none, and to a screen reader always", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<p id="page-footer" class="page-footer" hidden aria-hidden="true"><\/p>/, "the foot's count is read twice by a screen reader");
    assert.match(markup, /<p id="page-live" class="visually-hidden" aria-live="polite"><\/p>/, "there is no live region for the count");
    assert.match(markup, /<\/button>\s*<!--[^>]*-->\s*<span id="page-count" class="page-count" hidden aria-hidden="true"><\/span>/, "the count has no place beside the brand");
    const reader = await source("reader/reader.js");
    const curtain = bodyOf(reader, "refreshCurtain");
    assert.match(curtain, /pageCount\.hidden = settings\.reader\.pageNumber;/, "the bar's count stands beside the foot's");
    assert.match(curtain, /if \(pageLive\.textContent !== spoken\) pageLive\.textContent = spoken;/, "the live region is written on every scroll, or not at all");
    assert.match(bodyOf(reader, "applyAppearance"), /root\.dataset\["readerPageNumber"\] = String\(reader\.pageNumber\);/, "the setting is not stamped for the stylesheet");
    const styles = await source("reader/reader.css");
    assert.match(styles, /\n\.page-count \{\s*color: var\(--page-muted\);\s*font-variant-numeric: tabular-nums;\s*white-space: nowrap;/, "the bar's count is not in the muted voice");
    // Gone under a phone's width, with the bar's one tight dress (page.css):
    // the full-screen tool yields to the row's width, and the count would
    // only evict it.
    const shared = await source("assets/page.css");
    const narrow = shared.slice(shared.indexOf("@media (max-width: 30rem) {\n  .page-bar {"));
    assert.match(narrow, /\.page-count \{\s*display: none;/, "the bar's count crowds a phone's bar, where the full-screen tool would yield to it");
  });

  it("is a setting on the settings page, beside the reader-only switch, in every language", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /id="reader-only" \/>[\s\S]*?<input type="checkbox" id="page-number" \/>[\s\S]*?id="keep-articles"/, "the page-number row does not stand between the reader-only and the keep rows");
    assert.match(markup, /data-i18n="options_page_number">Page number in the Pages layout</, "the row's name is not the catalogue's");
    assert.match(markup, /data-fold data-i18n="options_page_number_hint"/, "the row has no folded note");
    const script = await source("options/options.js");
    assert.match(script, /writeConfig\(\{ reader: \{ pageNumber: toggle\.checked \} \}\)/, "the switch does not write the reader's setting");
    assert.equal((script.match(/renderPageNumber\(\);/g) ?? []).length, 2, "the switch is not drawn on both renders");
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      assert.ok(typeof catalogue["options_page_number"]?.message === "string", `${lang} has no name for the row`);
      assert.ok(typeof catalogue["options_page_number_hint"]?.message === "string", `${lang} has no note for the row`);
    }
  });

  it("is promised in the README as a setting, on by default (D249)", async () => {
    const readme = await source("../README.md");
    assert.match(readme, /\*\*Page number in the Pages layout\*\* in the settings, on by default/, "the README still promises a quiet foot the reader no longer has");
    assert.match(readme, /the page being read keeps its first line and only its last lines go behind the bar/, "the README does not say what a bar does to the page");
  });
});
