import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The settings page's navigation (D254): the column beside the page, the same
 * list in the bar where there is no room for a column, the marker that
 * follows the reading, and the landing an address makes.
 *
 * What is held here is the wiring - which element carries what, which rule
 * draws the marker, which road a press takes. Whether it feels right on a
 * phone is a smoke test's question (SMOKE-TESTS.md); whether the two shapes
 * of the list can drift apart is this file's.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * One rule's body, by its selector.
 *
 * @param {string} css
 * @param {string} selector
 */
function rule(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("\n}\n", at));
}

describe("the settings page's navigation", () => {
  it("builds the bar's list from the column's own links, so the two cannot disagree", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /<select\s+id="section-jump"/, "the bar has no list of sections");
    assert.match(
      markup.slice(markup.indexOf('id="section-jump"'), markup.indexOf('id="section-jump"') + 400),
      /data-i18n-aria-label="options_section_jump"/,
      "the bar's list is unnamed for a screen reader",
    );
    // Empty in the markup: filled from the column, never written twice.
    assert.match(markup, /data-i18n-aria-label="options_section_jump"\s*\n\s*><\/select>/, "the bar's list is written out by hand");

    const script = await source("options/sections.js");
    assert.match(script, /document\.querySelectorAll\("#sections a\[href\^='#'\]"\)/, "the list is not read off the column");
    assert.match(script, /option\.textContent = link\.textContent/, "the bar's lines are not the column's own");
  });

  it("takes the bar's list again whenever a section joins or leaves the page", async () => {
    const options = await source("options/options.js");
    // The two moments a section comes or goes: the first-steps card looking
    // at the stores, and the translation-off switch taking the models away.
    const steps = options.slice(options.indexOf("function renderFirstSteps"), options.indexOf("function availableModels"));
    assert.match(steps, /fillSectionSelect\(\);/, "the card's line is never added to the bar's list");
    const mode = options.slice(options.indexOf("function renderNoTranslation"), options.indexOf("function renderBubbleOff"));
    assert.match(mode, /fillSectionSelect\(\);/, "the mode's sections are never taken out of the bar's list");
  });

  it("marks the section being read on its edge, never with a fill", async () => {
    const css = await source("options/options.css");
    const current = rule(css, '.sections a[aria-current="location"]');
    assert.match(current, /border-inline-start-color: var\(--page-accent\)/, "the marker is not a line");
    assert.doesNotMatch(current, /background/, "the marker is a fill, which an e-ink panel rounds away");
    assert.doesNotMatch(current, /transition/, "the marker moves with the scroll and must not fade");

    const script = await source("options/sections.js");
    assert.match(script, /link\.setAttribute\("aria-current", CURRENT\)/, "the marker is not said to a screen reader");
    // The last heading past the upper third, and the last section at the
    // very foot of the page - a short last section never reaches the line.
    assert.match(script, /const line = under \+ \(window\.innerHeight - under\) \/ 3;/, "the line is not the upper third under the bar");
    assert.match(script, /if \(foot\) return String\(visible\[visible\.length - 1\]\?\.id\);/, "the foot of the page leaves the marker behind");
  });

  it("lands an address on the thing it names, with the focus and no clock", async () => {
    const script = await source("options/sections.js");
    assert.match(script, /landed\.scrollIntoView\(\);/, "the landing is not a jump");
    assert.doesNotMatch(script, /behavior: "smooth"/, "the landing is animated, which an e-ink panel draws as a smear");
    assert.match(script, /landed\.focus\(\{ preventScroll: true \}\)/, "the keyboard does not land where the eye does");
    assert.doesNotMatch(script, /setTimeout|setInterval/, "the ring leaves on a clock rather than with the focus");
    // A row whose switch is off is not on the page: the address walks out to
    // the nearest thing that is drawn rather than scrolling nowhere.
    assert.match(script, /while \(target !== null && !shown\(target\)\)/, "an address naming a hidden row lands nowhere");
    assert.match(script, /window\.addEventListener\("hashchange"/, "the page ignores an address changing under it");

    const css = await source("options/options.css");
    // A row is marked with a bar at its leading edge, drawn inside the row so
    // nothing shifts; a section heading is marked with nothing at all (F5).
    const landed = rule(css, ".row[data-landed]");
    assert.match(landed, /box-shadow: inset 3px 0 0 var\(--page-accent\)/, "a landed row wears no mark");
    assert.match(css, /:is\(h1, h2, h3, section, details\):focus \{\s*outline: none;/, "a heading focused for a screen reader still wears a ring");
    assert.match(script, /if \(landed\.classList\.contains\("row"\)\)/, "a section heading is marked like a row");
    assert.match(script, /document\.addEventListener\("pointerdown", clearMark\)/, "the mark outstays the next press");
  });

  it("stands the column under the bar and hides it where the bar speaks for it", async () => {
    const css = await source("options/options.css");
    assert.match(rule(css, ".sections"), /display: none/, "the column shows on a narrow screen, where there is no room");
    const wide = css.slice(css.indexOf("@media (min-width: 60rem)"));
    assert.match(wide, /\.sections \{[\s\S]*?align-self: start;[\s\S]*?position: sticky;[\s\S]*?top: calc\(var\(--header-h\) \+ 1rem\);/, "the column does not stand under the stuck bar, or is stretched so it cannot stick (F1)");
    assert.match(wide, /max-height: calc\(100dvh/, "a short window leaves the end of the list unreachable");
    assert.match(wide, /overscroll-behavior: contain/, "scrolling the list to its end drags the page with it");
    // And nothing stands between the column and the grid it is an item of:
    // a wrapper is exactly what stopped the sticky from sticking.
    const markup = await source("options/options.html");
    assert.match(markup, /<div class="page-body">\s*<nav id="sections"/, "a wrapper stands between the grid and the column");
  });

  it("makes every setting a paragraph names a link to its own row (P9)", async () => {
    const markup = await source("options/options.html");
    const sites = markup.slice(markup.indexOf('data-i18n="options_disabled_intro"'));
    assert.match(sites, /<a href="#s-translationOff" data-i18n="options_no_translation">/, "the sites intro still only names the switch");
    assert.match(sites, /<a href="#s-bubbleOff" data-i18n="options_bubble_off">/, "the sites intro still only names the sub-option");
    // The names come from the rows' own keys, so renaming a setting renames
    // every reference to it.
    const pair = markup.slice(markup.indexOf('id="s-pair"'));
    assert.match(pair.slice(0, 900), /<a href="#translation-models" data-i18n="options_models_heading">/, "the pair's way to the models is not a link");
  });
});
