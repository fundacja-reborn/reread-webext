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
    // The strip holds a control since D278, so it is the count inside it
    // that is hidden from a screen reader, not the strip.
    assert.match(markup, /<div id="page-footer" class="page-footer" hidden>/, "the foot's strip is gone, or hidden from a screen reader with the button inside it");
    assert.match(markup, /<span id="page-foot-count" class="page-foot-count" aria-hidden="true"><\/span>/, "the foot's count is read twice by a screen reader");
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

  it("is a setting on the settings page, first of the Pages layout's own section, in every language", async () => {
    const markup = await source("options/options.html");
    // Moved into the section the Pages layout's three settings share
    // (D250): the count, the gesture that turns a page and the signal that
    // one has turned, in the order a page is read in.
    assert.match(markup, /id="paged-layout"[\s\S]*?<input type="checkbox" id="page-number"[\s\S]*?id="s-touchTurn"[\s\S]*?id="s-turnEffect"/, "the page-number row does not open the Pages layout's section");
    // Named after the strip and what it is for, not after the number
    // (Michał's wording, 2026-09-21): the strip holds a page number or a
    // percent - reading progress either way - and the contents' button,
    // and a switch called "page number" said a third of that.
    assert.match(markup, /data-i18n="options_page_number">Show the page footer with reading progress</, "the row's name is not the catalogue's");
    // One sentence, and nothing folded behind it since Michał's smoke
    // (2026-09-19): what stood there - that the text reaches lower without
    // the count, and that a screen reader still reads it - is a detail about
    // a switch whose own line already says what it shows.
    assert.match(markup, /<p class="row-note" id="hint-pageNumber" data-i18n="options_page_number_hint">/, "the row's note is not one plain sentence");
    assert.doesNotMatch(markup, /more-pageNumber|options_page_number_more/, "the row still folds a rest away");
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
    assert.match(readme, /\*\*Show the page footer with reading progress\*\* under \*\*Pages layout\*\* in the settings, on by default/, "the README still promises a quiet foot the reader no longer has");
    assert.match(readme, /the page being read keeps its first line and only its last lines go behind the bar/, "the README does not say what a bar does to the page");
  });
});

/**
 * One rule of a stylesheet, by its selector at the start of a line.
 *
 * @param {string} styles
 * @param {string} selector
 */
function ruleOf(styles, selector) {
  const at = styles.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return styles.slice(at, styles.indexOf("\n}", at));
}

describe("the way to the contents in the page's foot, and the contents as a sheet (D278)", () => {
  it("puts a button for the contents at the strip's start and the count at its end", async () => {
    const markup = await source("reader/reader.html");
    const foot = /<div id="page-footer" class="page-footer" hidden>([\s\S]*?)\n    <\/div>/.exec(markup);
    assert.ok(foot !== null, "the foot's strip does not hold its two children");
    const inside = String(foot[1]);
    assert.match(inside, /<button\s+type="button"\s+id="page-foot-toc"\s+class="page-foot-toc"\s+hidden\s+title="Contents"\s+data-i18n-title="reader_book_toc"\s+aria-label="Contents"\s+data-i18n-aria-label="reader_book_toc"\s*>/, "the button is not hidden until a document has contents, or is not named the way the menu's row is");
    assert.ok(inside.indexOf('id="page-foot-toc"') < inside.indexOf('id="page-foot-count"'), "the button does not come before the count");
    const styles = await source("reader/reader.css");
    const strip = ruleOf(styles, ".page-footer");
    assert.match(strip, /display: flex;\s*align-items: center;\s*justify-content: flex-end;/, "the count does not stand at the row's end");
    assert.match(strip, /pointer-events: none;/, "the strip takes presses meant for the page");
    // The row is as wide as the text's column: the measure the body is cut
    // to, read in the body's own face - which is why the strip itself wears
    // no face of its own - or the body's side padding on a narrow window.
    // The body is a border box the measure wide with its side padding
    // inside it, so the text begins the padding in from where the measure
    // does (measured in Chrome: text at 88px, the row's start at 88px).
    assert.match(strip, /--page-foot-inset: calc\(max\(0px, \(100% - var\(--reader-measure, 65ch\)\) \/ 2\) \+ 1\.5rem\);/, "the row is not the column's width");
    assert.doesNotMatch(strip, /font-family|font-size/, "the strip reads `ch` in a face that is not the text's");
    const shared = await source("assets/page.css");
    assert.match(ruleOf(shared, "body"), /padding: 2\.5rem 1\.5rem 4rem;/, "the body's side padding is no longer what the foot's row counts");
    assert.match(shared, /\n\* \{\s*box-sizing: border-box;/, "the body is no longer a border box, and the measure no longer holds its padding");
    const counted = ruleOf(styles, ':root[data-reader-page-number="true"] .page-footer');
    assert.match(counted, /overflow: visible;\s*padding: 0\.2rem var\(--page-foot-inset\) calc\(0\.2rem \+ env\(safe-area-inset-bottom, 0px\)\);/, "the row's sides are not the column's, or the button's reach is clipped");
  });

  it("gives the button the strip and the air above it and never a line of the text, and costs the page nothing", async () => {
    const styles = await source("reader/reader.css");
    const button = ruleOf(styles, ".page-foot-toc");
    // Out of the flow: the strip is as tall with the button as without, so
    // showing it re-cuts no page.
    assert.match(button, /position: absolute;\s*bottom: 0;\s*inset-inline-start: calc\(var\(--page-foot-inset\) - 1rem\);/, "the button stands in the strip's flow, or not under the column's first letter");
    assert.match(button, /width: 3rem;\s*height: calc\(100% \+ var\(--page-foot-air, 0\.5rem\)\);/, "the button's reach is not the strip and the air above it");
    assert.doesNotMatch(button, /44px|min-height/, "the button wears a touch floor that would lie over the last line's first word");
    assert.match(button, /color: inherit;\s*pointer-events: auto;/, "the button is not in the count's muted voice, or takes no press");
    assert.match(ruleOf(styles, ".page-foot-toc .reader-icon"), /width: 1rem;\s*height: 1rem;/, "the glyph is not the size of the count's line");
    assert.match(styles, /\n:root:not\(\[data-reader-page-number="true"\]\) \.page-foot-toc \{\s*display: none;/, "with the count off the button is clipped from sight and left in the tab order");
    // The page table is cut from the band, and the band from the strip's
    // edge: the token the reach is counted from is the band's own.
    assert.match(styles, /--page-foot-air: 0\.5rem;/);
  });

  it("opens the contents on a press that was meant, and shows both doors over the same documents", async () => {
    const reader = await source("reader/reader.js");
    const doors = bodyOf(reader, "updateTocButtons");
    assert.match(doors, /const none = docToc\.length === 0;\s*if \(navToc !== null\) navToc\.hidden = none;\s*if \(footToc !== null\) footToc\.hidden = none;/, "the foot's button and the menu's row are shown by two rules");
    assert.match(reader, /footToc\?\.addEventListener\("click", \(event\) => \{\s*if \(!meantPress\(event\.detail === 0 \? null : lastTap\(\)\)\) return;\s*openTocDialog\(\);\s*\}\);/, "a thumb resting on the foot opens the contents, or a key cannot");
    // A press on a button never turns the page, by either road.
    assert.match(reader, /const TURN_STOPS =\s*"button, /, "a press on the foot's button turns the page");
  });

  it("stands the contents as a sheet at the window's start edge, by its id alone", async () => {
    const styles = await source("reader/reader.css");
    const sheet = ruleOf(styles, "#toc-dialog");
    assert.match(sheet, /inset-block: 0;\s*inset-inline: 0 auto;\s*margin: 0;/, "the sheet is centred the way the engine centres a modal");
    assert.match(sheet, /height: 100dvh;\s*max-width: none;\s*max-height: none;/, "the sheet is not the window's height");
    assert.doesNotMatch(sheet, /position:/, "the sheet re-declares what the engine's modal already is");
    // The search and the footnote wear the class and stay boxes.
    assert.match(ruleOf(styles, ".toc-dialog"), /max-height: min\(80vh, 42rem\);/, "the class every dialog wears became a sheet");
    assert.doesNotMatch(styles, /#search-dialog \{[^}]*inset-inline/, "the search became a sheet too");
    assert.match(ruleOf(styles, "#toc-dialog .toc-rows"), /flex: 1 1 auto;\s*min-height: 0;/, "a long table does not scroll inside the sheet");
    // Motion once, on the way in, and only where it is drawn well.
    assert.match(styles, /@media \(prefers-reduced-motion: no-preference\) \{\s*#toc-dialog\[open\] \{\s*animation: contents-sheet-in 140ms ease-out;/, "the sheet moves for a reader who asked for stillness");
    const shared = await source("assets/page.css");
    assert.match(shared, /:root\[data-reader-theme="eink"\] \*,[\s\S]*?animation: none !important;/, "e-ink paper no longer stops the sheet's motion");
  });

  it("says in the count's setting that the button stands there too, by the catalogue's own name, in every language", async () => {
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      const name = catalogue["reader_book_toc"]?.message ?? "";
      assert.ok(name.length > 0, `${lang} has no name for the contents`);
      assert.ok((catalogue["options_page_number_hint"]?.message ?? "").includes(name), `${lang}: the note does not name the button "${name}"`);
    }
    const markup = await source("options/options.html");
    assert.match(markup, /the "Contents" button is shown there too\.\s*<\/p>/, "the settings page's own words lag behind the catalogue");
    const readme = await source("../README.md");
    assert.match(readme, /a small \*\*Contents\*\* button is shown at the other end of the same line/, "the README does not say where the button is");
    assert.match(readme, /is a panel at the left side of the window, as tall as the window/, "the README does not say the contents are a panel");
  });
});
