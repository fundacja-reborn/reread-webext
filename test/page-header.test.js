import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The bar stuck to the top of every page (D219): the reading list, the
 * highlights, the saved phrases and the settings wear the article view's
 * stuck box now - one `.page-chrome` in page.css, the reader's own class
 * kept for what only the article view does (the ribbon that folds the bar
 * away). Its height is a token the pages lean on: `scroll-padding-top`
 * keeps anchors and focused rows out from under the bar, and the bar's box
 * takes the token as its height outright, so the number and the bar on
 * screen cannot quietly part. The rules are markup and stylesheets, so this
 * reads them the way `reader-fullscreen-tool` does.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The declarations of one rule, found by its selector standing alone on a
 * line - the first such rule in the sheet.
 *
 * @param {string} styles
 * @param {string} selector
 */
function ruleOf(styles, selector) {
  const at = styles.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return styles.slice(at, styles.indexOf("}", at));
}

describe("the bar stuck to the top of every page", () => {
  it("is one box in one home: stuck at the window's top, on its own paper, above the page, with no transition", async () => {
    const box = ruleOf(await source("assets/page.css"), ".page-chrome");
    assert.match(box, /position: sticky;/, "the box scrolls away with the page");
    assert.match(box, /top: 0;/, "the box sticks somewhere below the window's top");
    assert.match(box, /background: var\(--page-bg\);/, "the page would show through the stuck box");
    // Above the scrim (1) and above everything in a list - the highlighter's
    // pins and badges stand at 0 for this reason.
    assert.match(box, /z-index: 2;/, "the box lost its place over the scrim and the lists");
    assert.match(box, /padding-top: var\(--header-air\);/, "the stuck box holds no paper over the bar");
    assert.doesNotMatch(box, /transition/, "the box animates, which an e-ink panel draws as a smear");
    // The bar rests exactly where it sticks: the page's whole headroom is
    // the box's own paper, and the body keeps none - with half of it on
    // the body the box slid up by that half on the first scroll (Michał's
    // report, 2026-09-14).
    assert.match(ruleOf(await source("assets/page.css"), "body:has(> .page-chrome)"), /padding-top: 0;/, "the body keeps headroom over the box, which the first scroll eats");
    for (const [path, selector] of /** @type {[string, string][]} */ ([
      ["reader/reader.css", "body.reader"],
      ["vocab/vocab.css", "body"],
      ["options/options.css", "body"],
    ])) {
      assert.doesNotMatch(ruleOf(await source(path), selector), /padding-top/, `${path}: the body keeps a top padding of its own over the box`);
    }
  });

  it("is the reader's box on the reading list and the highlights too, the folding kept to the article view", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<div class="reader-chrome page-chrome">/, "the reader's box does not wear the shared class");
    assert.match(markup, /<header class="reader-bar page-bar">/, "the reader's bar does not wear the shared class");
    const styles = await source("reader/reader.css");
    assert.doesNotMatch(styles, /position: sticky/, "the reader sticks a box of its own beside the shared one");
    assert.doesNotMatch(styles, /\n\.reader-chrome \{/, "the reader dresses its box twice");
    assert.doesNotMatch(styles, /\n\.reader-bar \{/, "the reader dresses its bar twice");
    // The ribbon folds the bar only over an article: a list keeps its whole
    // chrome, and the shared rule must not fold it.
    assert.match(
      styles,
      /:root\[data-reader-chrome="hidden"\] body\.reader:has\(#article:not\(\[hidden\]\)\) \.reader-chrome > :not\(\.chrome-tab\) \{\s*display: none;/,
      "the bar folds away outside the article view",
    );
    for (const page of ["vocab/vocab.html", "options/options.html"]) {
      const other = await source(page);
      assert.match(other, /<div class="page-chrome">/, `${page} has no shared box`);
      assert.match(other, /<div class="page-bar">/, `${page} has no shared bar`);
    }
  });

  it("has a height the stylesheet knows, as one token every page shares, which the bar's box takes outright", async () => {
    const styles = await source("assets/page.css");
    assert.match(styles, /--header-h: calc\(var\(--header-air\) \+ var\(--bar-h\)\);/, "the bar's reach is not one token");
    const bar = ruleOf(styles, ".page-bar");
    assert.match(bar, /height: var\(--bar-h\);/, "the bar's box is left to measure itself");
    assert.match(bar, /border-bottom: 1px solid var\(--page-line\);/, "the line under the bar is not the separators' token");
    assert.doesNotMatch(bar, /transition/, "the bar animates");
    // The bar is interface (D104): nothing in it follows the Aa panel's size.
    assert.doesNotMatch(bar, /--reader-size/, "the bar's height follows the text size");
    // The floor the token counts is the floor the tools stand on, on every
    // page - the reader's tools keep their own rule and must stand on the
    // same number.
    const parts = /--bar-h: calc\((\d+(?:\.\d+)?rem) \+ (\d+(?:\.\d+)?rem) \+ 1px\);/.exec(styles);
    assert.ok(parts !== null, "the bar's height is not the tools' floor, the air under them and the line");
    const [, floor, air] = parts;
    assert.match(ruleOf(styles, ".page-tools > button"), new RegExp(`min-height: ${floor};`), "the tools stand on another floor than the token counts");
    assert.match(bar, new RegExp(`padding-bottom: ${air};`), "the air under the tools is not what the token counts");
    // The reader's tools stand in the same frame: its span wears the class
    // (D221), and no floor of the reader's own is left to drift.
    assert.match(await source("reader/reader.html"), /<span class="reader-tools page-tools">/, "the reader's tools do not stand in the shared frame");
    const reader = await source("reader/reader.css");
    assert.doesNotMatch(reader, /#menu \{[^}]*min-height/, "the reader keeps a floor of its own for its tools");
    // And the tight dress under a phone's width is the shared bar's too:
    // kept as the reader's own, it left the phrases' tools a desktop's
    // distance apart on the same phone (Michał's screenshots, 2026-09-14).
    assert.doesNotMatch(reader, /\n\s*\.reader-tools \{|\n\s*\.reader-bar \{/, "the reader dresses its bar or its tools twice");
    assert.match(styles, /@media \(max-width: 30rem\) \{\s*\.page-bar \{\s*gap: 0\.5rem;\s*\}\s*\.page-tools \{\s*gap: 0\.4rem;/, "the bar has no tight dress under a phone's width shared by every page");
  });

  it("says a tool in hand by a real wash alone, so that 16 greys keep it and the bar stays quiet, on every page's bar", async () => {
    const styles = await source("assets/page.css");
    const lit = ruleOf(styles, '.page-tools > button[aria-pressed="true"],\n.page-tools > button[aria-expanded="true"]');
    // The wash and the ring are the root's two tokens since D237, so a
    // palette can say otherwise: the lit rule reads nothing else.
    assert.match(lit, /background: var\(--page-pressed-bg\);\s*box-shadow: var\(--page-pressed-ring\);/, "the lit tool lights itself by a wash of its own");
    // A quarter of the accent lands two greys under the paper; 12% rounded
    // back into it (Michał's photo from the Boox, 2026-09-14).
    const root = ruleOf(styles, ":root");
    const wash = /--page-pressed-bg: color-mix\(in srgb, var\(--page-accent\) (\d+)%, transparent\);/.exec(root);
    assert.ok(wash !== null, "the lit token has no wash of the accent");
    assert.ok(Number(wash[1]) >= 25, `the lit token's wash is ${wash[1]}% of the accent - back to invisible on e-ink`);
    // The frame stays the frame: D221's doubled accent ring was too loud
    // for a bar over an article (Michał's second photo from the Boox,
    // 2026-09-14) - the wash is the one signal on every paper but e-ink's,
    // where the ring token is set (test/eink-palette.test.js).
    assert.match(root, /--page-pressed-ring: none;/, "the lit tool wears a ring on every paper");
    assert.doesNotMatch(lit, /border-color|outline/, "the lit tool wears a frame of its own");
    assert.doesNotMatch(lit, /transition/, "the lit state animates");
    // One rule for every page's bar: the reader keeps none of its own.
    assert.doesNotMatch(await source("reader/reader.css"), /#marker\[aria-pressed="true"\]/, "the reader lights its tools by a rule of its own");
    // The full-screen tool is not lit: its glyph turns inward while the
    // page has the screen, and a wash on top of it lit the bar for the
    // whole of a reading for nothing.
    assert.doesNotMatch(styles, /:root:fullscreen #fullscreen(?:,|\s*\{)/, "the full-screen tool is lit in full screen, on top of its own glyph");
  });

  it("tells the browser where the visible page begins, so anchors, focus and the pages' own scrolls land under the bar, not behind it", async () => {
    const styles = await source("assets/page.css");
    const padding = ruleOf(styles, ":root:has(.page-chrome)");
    assert.match(padding, /scroll-padding-top: calc\(var\(--header-h\) \+ 0\.25rem\);/, "the root's scroll padding is not the bar's reach and a breath");
    // The landing pads every anchor keeps add their air on top of the
    // padding; none of them may have grown into the bar's own measure.
    for (const [path, selector] of /** @type {[string, string][]} */ ([
      ["options/options.css", "h2"],
      ["vocab/vocab.css", ".filter-status"],
      ["vocab/vocab.css", ".transfer-section"],
      ["reader/reader.css", ".marks-transfer"],
      ["reader/reader.css", ".transfer-section"],
    ])) {
      assert.match(ruleOf(await source(path), selector), /scroll-margin-top: 0\.75rem;/, `${selector} in ${path} lost its landing pad`);
    }
    // The pages' own scrolls aim at the top of what they show and let the
    // padding place it: no arithmetic of their own against the bar.
    const reader = await source("reader/reader.js");
    assert.match(reader, /libraryRows\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\)/, "a turned page of the list no longer starts at its top");
    assert.match(reader, /marksRowsList\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\)/, "a turned page of the highlights no longer starts at its top");
    assert.match(await source("vocab/vocab.js"), /filterStatus\.scrollIntoView\(\{ block: "start" \}\)/, "\"Show in list\" no longer lands on the filter's line");
    // The shelf's fold measures the visible page from the same number: a
    // book's name under the bar is out of view as much as one past the
    // window's top.
    const shelf = await source("lib/lookup-shelf.js");
    assert.match(shelf, /book\.getBoundingClientRect\(\)\.top < coveredTop\(\)/, "the shelf's fold measures the visible page from the window's edge");
    assert.match(shelf, /getComputedStyle\(document\.documentElement\)\.scrollPaddingTop/, "the shelf's fold does not read the root's scroll padding");
  });

  it("leaves the article view to its own arithmetic: no scroll padding over an article", async () => {
    const styles = await source("reader/reader.css");
    const standDown = ruleOf(styles, ":root:has(body.reader #article:not([hidden]))");
    assert.match(standDown, /scroll-padding-top: auto;/, "the article view keeps the list views' scroll padding");
    // The position restore steps back from `scrollIntoView` by the bar's
    // measure; with the padding standing it would step back twice.
    const reader = await source("reader/reader.js");
    assert.match(reader, /block\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\);\s*(?:\/\/[^\n]*\n\s*)*scrollBy\(0, -chromeFold\(\)\);/, "the position restore no longer steps back from under the bar by its own measure");
  });

  it("is the one stuck strip over a list: the selection's bar scrolls with the rows, under it", async () => {
    const styles = await source("reader/reader.css");
    const bar = ruleOf(styles, ".pick-bar");
    assert.doesNotMatch(bar, /position:/, "the selection's bar is stuck or lifted - a second strip of chrome over the list");
    assert.doesNotMatch(bar, /z-index:/, "the selection's bar carries a stacking of its own, which could paint over the stuck bar");
    // Nothing else on the page is stuck: the speech bar is fixed at the
    // bottom of the article view, and the two never meet - and the paged
    // layout's curtains, page count and edge line (D233, D239) are fixed
    // there too, over an article read by pages, never over a list.
    assert.equal((styles.match(/position: (?:sticky|fixed)/g) ?? []).length, 5, "a strip of chrome beyond the speech bar, the two curtains, the page count and the edge line is stuck or fixed on the reader page");
    assert.match(ruleOf(styles, ".page-curtain"), /position: fixed;/, "the curtain is not fixed to the window");
    assert.match(ruleOf(styles, ".page-head"), /position: fixed;\s*inset-inline: 0;\s*top: 0;/, "the head's curtain is not fixed to the window's top");
    const footer = ruleOf(styles, ".page-footer");
    assert.match(footer, /position: fixed;/, "the page count is not fixed to the window");
    // The foot is the phone's safe area alone by default (D238): the strip
    // the bars' height that stood here read on the Boox as three or four
    // empty lines under every page (Michał's photos, 2026-09-17). The
    // count's line comes with the setting, and no touch floor with it -
    // the count is not a control.
    assert.match(footer, /height: env\(safe-area-inset-bottom, 0px\);\s*overflow: hidden;/, "the foot keeps a strip under every page with the count off");
    assert.doesNotMatch(footer, /min-height|--foot-h/, "the foot's strip is the bars' height again");
    const counted = ruleOf(styles, ':root[data-reader-page-number="true"] .page-footer');
    assert.match(counted, /height: auto;\s*min-height: calc\(1\.4rem \+ env\(safe-area-inset-bottom, 0px\)\);/, "the count's strip is not one line with a breath of air, standing as tall before the count is written as after");
    assert.doesNotMatch(counted, /44px|--foot-h/, "the count's line wears a touch floor");
    assert.match(ruleOf(styles, "body.reader:has(#speech-bar:not([hidden])),\nbody.reader:has(#mark-bar:not([hidden]))"), /padding-bottom: calc\(var\(--foot-h\) \+ var\(--page-air\)\);/, "the scroll layout's room under a bar is not counted from the foot's token");
    assert.doesNotMatch(styles, /\.page-footer \{\s*display: none;/, "the page count leaves under a bar, and the band with it");
    // The token counts what stands in a bar: the buttons' floor, the air
    // above and below them, the line - and both bars take it as their floor.
    const foot = /--foot-h: calc\((\d+px) \+ (\d+(?:\.\d+)?)rem \+ 1px\);/.exec(styles);
    assert.ok(foot !== null, "the foot's height is not the buttons' floor, the air around them and the line");
    const [, floor, air] = foot;
    const transport = ruleOf(styles, ".speech-bar");
    assert.match(ruleOf(styles, ".speech-bar button"), new RegExp(`min-height: ${floor};`), "the transport's buttons stand on another floor than the token counts");
    assert.match(transport, new RegExp(`padding: ${Number(air) / 2}rem 0\\.6rem;`), "the air around the buttons is not what the token counts");
    assert.match(transport, /min-height: var\(--foot-h\);/, "the transport bar does not take the token as its floor");
    assert.match(ruleOf(styles, ".speech-bar.mark-bar"), new RegExp(`padding: ${Number(air) / 2}rem 0\\.4rem;`), "the pen's bar keeps other air than the token counts");
    assert.match(styles, /--page-air: 0\.75rem;/, "the page's margin is not one declared number");
    // The page's bottom margin (D238): only what keeps the last line's
    // descenders off what stands at the foot, and smaller than the top's.
    assert.match(styles, /--page-foot-air: 0\.5rem;/, "the page's bottom margin is not one declared number");
    // The reader reads both margins off the stylesheet rather than repeating them.
    const reader = await source("reader/reader.js");
    assert.match(reader, /airToken\("--page-air", 0\.75\)/, "the reader keeps a margin of its own beside the stylesheet's");
    assert.match(reader, /airToken\("--page-foot-air", 0\.5\)/, "the reader keeps a bottom margin of its own beside the stylesheet's");
    assert.match(reader, /bottom: Math\.max\(top, band\.bottom - pageFootAir\(\)\), floor: band\.bottom/, "the band's foot is not the small margin above what stands lowest");
  });

  it("hangs the reader's panels under the bar as sheets over the text, and offers each Aa row once", async () => {
    // Opened in the box's flow the panels grew the box and pushed the
    // article down; read by pages (D233) that re-cut every page for a band
    // a few lines tall, and closing the menu landed on page one (Michał's
    // smoke, 2026-09-17).
    const styles = await source("reader/reader.css");
    const sheets = ruleOf(styles, ".reader-chrome > .reader-panel,\n.reader-chrome > .nav-menu");
    assert.match(sheets, /position: absolute;\s*top: 100%;/, "the panels stand in the box's flow and push the text down");
    assert.match(sheets, /background: var\(--page-bg\);/, "the dimmed page shows through a sheet");
    // The shadow that says which layer the sheet is - the other pages' box
    // casts the same one on the dimmed page (page.css); e-ink paper drops it.
    assert.match(sheets, /box-shadow: 0 10px 24px -8px rgb\(0 0 0 \/ 0\.35\);/, "the sheet casts no shadow on the dimmed page");
    assert.match(styles, /:root\[data-reader-theme="eink"\] \.reader-chrome > :is\(\.reader-panel, \.nav-menu\) \{\s*box-shadow: none;/, "the sheet dithers a shadow on e-ink paper");
    // The curtains and the footer stand under the scrim: at zero, with the
    // pins and the badges, and never beside the scrim's 1 (a white strip
    // at the foot of a dimmed page, Michał's smoke 2026-09-17).
    for (const selector of [".page-curtain", ".page-head", ".page-footer"]) {
      assert.match(ruleOf(styles, selector), /z-index: 0;/, `${selector} stands beside or over the scrim`);
    }
    // The menu's own rule stands after the shared one, whose second line
    // `ruleOf` would find first.
    assert.match(styles, /\n\.reader-chrome > \.nav-menu \{\s*max-height: calc\(100dvh - var\(--header-h\) - 1rem\);\s*overflow-y: auto;/, "a long menu cannot scroll within itself");
    // The e-ink merge once doubled the Layout row (2026-09-17): every row of
    // the Aa panel stands once.
    const markup = await source("reader/reader.html");
    for (const id of ["theme-choices", "layout-choices", "font-choices", "line-height-choices", "align-choices", "hyphens-choices", "paragraphs-choices", "links-choices", "marker-color-choices"]) {
      assert.equal((markup.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `the ${id} row stands more than once, or not at all`);
    }
  });

  it("measures the visible text from the page's own top when read by pages: the voice, the position, the bubble", async () => {
    // The strip between the bar's edge and the page's first line is paper
    // over the tail of the page before; measured from the bar's edge, the
    // voice began a page on the paragraph before it and the position saved
    // under the curtain reopened a page early (Michał's smoke, 2026-09-17).
    const reader = await source("reader/reader.js");
    assert.match(reader, /function textFold\(\) \{\s*return paged\(\) \? pageBand\(\)\.top : chromeFold\(\);/, "the text's fold is not the page's top when read by pages");
    assert.match(reader, /fold: textFold,/, "the voice measures the first visible sentence from the bar's edge");
    assert.match(reader, /covered: textFold,/, "the bubble parks its line under the bar's edge, behind the page's curtain");
    assert.match(reader, /function topBlockIndex\(\) \{[\s\S]*?const line = textFold\(\) \+ 2;/, "the position is read under the bar's edge, behind the page's curtain");
    // The e-ink sheet says its edge with a line where the others cast a shadow.
    const styles = await source("reader/reader.css");
    assert.match(styles, /:root\[data-reader-theme="eink"\] \.reader-chrome > :is\(\.reader-panel, \.nav-menu\) \{\s*box-shadow: none;\s*border-bottom: 1px solid var\(--page-border\);/, "the e-ink sheet has neither a shadow nor a line under its edge");
  });

  it("holds nothing any more: the hold module went with the offset it measured", async () => {
    await assert.rejects(source("lib/chrome-hold.js"), "the hold module is still in the package");
    for (const path of ["assets/page.css", "reader/reader.css", "reader/reader.js", "vocab/vocab.js", "options/options.js"]) {
      assert.doesNotMatch(await source(path), /--chrome-hold|holdChrome/, `${path} still holds the chrome`);
    }
  });
});
