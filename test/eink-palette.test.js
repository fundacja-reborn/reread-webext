import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

/**
 * The e-ink paper's one rule about fills (D237): nothing under text, and
 * nothing under the words of a control that is on, darker than 80% of
 * white - the four lightest of a panel's sixteen greys. The first cut
 * (D234) reasoned in sRGB and stood the highlighter's inks at 58% to 82%
 * of white; the photo from the Boox showed them two or three greys darker
 * than that arithmetic, a mark so dark the words under it could hardly be
 * read, and the Aa panel's lit buttons as ten dark stains. What a smoke
 * test on glass cannot catch - the glass shows the arithmetic - the floor
 * here can: every fill of the e-ink palette, composed over white the way
 * the panel composes it, stays at or above the floor.
 *
 * "Brightness" is the grey the panel would show for a colour: the Rec. 709
 * luma of the sRGB values as they stand, in percent of white - the measure
 * the plan's tables reason in (§3.2 of `planning/stronicowanie-i-eink.md`),
 * not WCAG's linear luminance.
 */

const ROOT = new URL("../src/", import.meta.url);

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The first rule opening with `selector` - the selector list and the
 * declarations up to the closing brace.
 *
 * @param {string} styles
 * @param {string} selector
 * @returns {string}
 */
function blockOf(styles, selector) {
  const at = styles.indexOf(selector);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  const open = styles.indexOf("{", at);
  return styles.slice(at, styles.indexOf("}", open));
}

/**
 * @param {string} block
 * @param {string} property
 * @returns {string}
 */
function valueOf(block, property) {
  const found = new RegExp(`${property.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`).exec(block);
  assert.notEqual(found, null, `${property} is not declared`);
  return (found?.[1] ?? "").trim();
}

/** @typedef {{ r: number, g: number, b: number, a: number }} Paint */

/**
 * A hex colour or an rgba() as numbers.
 *
 * @param {string} value
 * @returns {Paint}
 */
function paint(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] ?? "";
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert.notEqual(rgba, null, `"${value}" is neither a hex colour nor an rgba()`);
  return {
    r: Number(rgba?.[1]),
    g: Number(rgba?.[2]),
    b: Number(rgba?.[3]),
    a: Number(rgba?.[4]),
  };
}

/**
 * The colour a wash leaves over a paper.
 *
 * @param {Paint} wash
 * @param {Paint} paper
 * @returns {Paint}
 */
function over(wash, paper) {
  const mix = (/** @type {number} */ top, /** @type {number} */ under) => top * wash.a + under * (1 - wash.a);
  return { r: mix(wash.r, paper.r), g: mix(wash.g, paper.g), b: mix(wash.b, paper.b), a: 1 };
}

/**
 * The grey a panel shows for a colour, in percent of white.
 *
 * @param {Paint} colour
 * @returns {number}
 */
function brightness(colour) {
  return ((0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b) / 255) * 100;
}

const WHITE = paint("#ffffff");
/** Four greys under white on a panel of sixteen: `#cccccc`. */
const FLOOR = brightness(paint("#cccccc"));

describe("the e-ink palette's fills (D237)", () => {
  it("keeps the highlighter's four inks between the floor and the light theme's yellow", async () => {
    const eink = blockOf(await source("reader/reader.css"), ':root[data-reader-theme="eink"]');
    const light = blockOf(await source("reader/reader.css"), ':root[data-reader-theme="light"]');
    const ceiling = brightness(over(paint(valueOf(light, "--reader-marker-yellow")), WHITE));
    for (const ink of ["yellow", "green", "blue", "pink"]) {
      const shown = brightness(over(paint(valueOf(eink, `--reader-marker-${ink}`)), WHITE));
      assert.ok(shown >= FLOOR - 0.05, `${ink} lands at ${shown.toFixed(1)}% of white, under the floor of ${FLOOR.toFixed(1)}%`);
      // Not the light theme's own wash either: that one is the grey a
      // Boox rounds into the paper (D234's reason for the theme).
      assert.ok(shown < ceiling, `${ink} lands at ${shown.toFixed(1)}% of white, no stronger than the light theme's yellow`);
    }
  });

  it("keeps the spoken sentence and the spoken word over it above the floor, as washes", async () => {
    const eink = blockOf(await source("reader/reader.css"), ':root[data-reader-theme="eink"]');
    const sentence = paint(valueOf(eink, "--reader-speaking"));
    const word = paint(valueOf(eink, "--reader-speaking-word"));
    // Washes, not flat greys: a sentence read over a highlighter's mark
    // still shows the mark through it.
    assert.ok(sentence.a < 1 && word.a < 1, "a speaking wash is a flat grey that hides a mark under it");
    const read = over(sentence, WHITE);
    assert.ok(brightness(read) >= FLOOR - 0.05, `the sentence lands at ${brightness(read).toFixed(1)}% of white`);
    // The word is painted over the sentence's wash (priority 3 over 2,
    // read-aloud.js), and the two compose: what shows is the pair.
    const spoken = over(word, read);
    assert.ok(brightness(spoken) >= FLOOR - 0.05, `the spoken word lands at ${brightness(spoken).toFixed(1)}% of white`);
    // And still two greys under the sentence, or the word could not be seen
    // moving: a grey is a sixteenth of white.
    assert.ok(brightness(read) - brightness(spoken) >= 100 / 16, "the spoken word is not told from its sentence");
  });

  it("says a control that is on with a light grey inside a black frame, at the light theme's strength", async () => {
    const page = await source("assets/page.css");
    const eink = blockOf(page, ':root[data-reader-theme="eink"]');
    const lit = paint(valueOf(eink, "--page-pressed-bg"));
    assert.ok(brightness(lit) >= FLOOR - 0.05, `the lit fill lands at ${brightness(lit).toFixed(1)}% of white`);
    // The strength Michał chose from the light theme's panel (2026-09-17):
    // its quarter of amber over white, within a grey of it.
    const light = blockOf(page, ':root[data-reader-theme="light"]');
    const amber = paint(valueOf(light, "--page-accent"));
    const lightLit = over({ ...amber, a: 0.25 }, WHITE);
    assert.ok(Math.abs(brightness(lit) - brightness(lightLit)) <= 100 / 16, `the e-ink lit fill is ${brightness(lit).toFixed(1)}% of white against the light theme's ${brightness(lightLit).toFixed(1)}%`);
    // The frame: a line of the accent inside the border, and the accent is
    // black on this paper.
    assert.equal(valueOf(eink, "--page-pressed-ring"), "inset 0 0 0 1px var(--page-accent)");
    assert.equal(valueOf(eink, "--page-accent"), "#000000");
    assert.match(page, /:root\[data-reader-theme="eink"\] \.page-tools > button:is\(\[aria-pressed="true"\], \[aria-expanded="true"\]\) \{\s*border-color: var\(--page-accent\);/, "the lit tool's frame stays grey outside the black ring");
    // The press itself: one grey under the lit fill, and no darker.
    const pressed = paint(valueOf(blockOf(page, ':root[data-reader-theme="eink"] button:active:not(:disabled)'), "background"));
    assert.ok(brightness(pressed) >= FLOOR - 0.05, `the press lands at ${brightness(pressed).toFixed(1)}% of white`);
    assert.ok(brightness(lit) - brightness(pressed) >= 100 / 16 - 0.5, "the press is not told from the lit fill");
  });

  it("lights nothing differently on the other papers", async () => {
    // The tokens on the bare root are the quarter of the accent and no
    // ring - what every pressed state wore before the tokens existed.
    const root = blockOf(await source("assets/page.css"), "\n:root");
    assert.equal(valueOf(root, "--page-pressed-bg"), "color-mix(in srgb, var(--page-accent) 25%, transparent)");
    assert.equal(valueOf(root, "--page-pressed-ring"), "none");
    // And no other palette sets them: the light, sepia and dark blocks, and
    // the dark query, say nothing about the pair.
    const page = await source("assets/page.css");
    for (const theme of ["light", "sepia", "dark"]) {
      assert.doesNotMatch(blockOf(page, `:root[data-reader-theme="${theme}"]`), /--page-pressed/, `the ${theme} palette lights its controls its own way`);
    }
    assert.doesNotMatch(blockOf(page, "@media (prefers-color-scheme: dark) {\n  :root"), /--page-pressed/, "the dark query lights its controls its own way");
  });

  it("frames the swatches so the light inks do not dissolve into the paper", async () => {
    const reader = await source("reader/reader.css");
    assert.match(reader, /:root\[data-reader-theme="eink"\] \.marker-swatch \{\s*border-color: var\(--page-border\);/, "an e-ink swatch has no line of the control border's strength");
  });

  it("presses the bubble's doors the same way on e-ink paper", () => {
    const press = blockOf(
      STYLE,
      '.bubble[data-scheme="eink"] .actions button[data-action="save"]:active:not(:disabled):not([aria-disabled="true"])',
    );
    const fill = paint(valueOf(press, "background"));
    assert.ok(brightness(fill) >= FLOOR - 0.05, `the door's press lands at ${brightness(fill).toFixed(1)}% of white`);
    // A second line of the edge inside the door's own, drawn as an outline
    // inward: the bubble keeps no shadow inside itself (the lines test).
    assert.equal(valueOf(press, "outline"), "1px solid var(--edge)");
    assert.equal(valueOf(press, "outline-offset"), "-2px");
    // The same six selectors as the press rule the other papers share, so
    // the emulated hover after a tap wears it too.
    assert.match(press, /\.bubble\[data-scheme="eink"\]\[data-pointer="coarse"\] \.actions button\[data-action="settings"\]:hover:not\(:disabled\)/, "the tap's lingering hover keeps the quarter of black");
  });
});
