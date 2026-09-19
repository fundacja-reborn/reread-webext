import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * What a field says before anything is typed into it (Michał's smoke,
 * 2026-09-19).
 *
 * A placeholder has two jobs that pull against each other: it has to be read
 * - so it stands on the 4.5:1 floor this project holds text to, which the
 * browser's own translucent default falls through - and it must not be read
 * as what the field already holds, which is how it looked while it wore the
 * same ink as a note.
 *
 * So it has an ink of its own in every palette, and what is held here is the
 * pair of promises: above the floor on that palette's own paper, and paler
 * than the muted ink of the prose beside it. Computed from the sheet itself,
 * because a palette added by hand later is exactly where this would be
 * forgotten.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * WCAG 2.x contrast between two sRGB colours written as `#rrggbb`.
 *
 * @param {string} one
 * @param {string} other
 * @returns {number}
 */
function contrast(one, other) {
  /** @param {string} hex */
  const luminance = (hex) => {
    const parts = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
    const [r, g, b] = parts.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe("what a field says before it is filled in", () => {
  it("gives the placeholder an ink of its own in every palette", async () => {
    const css = await source("assets/page.css");
    // Every block that sets the muted ink is a palette: the page's own, the
    // browser's dark, and one for each paper chosen by hand.
    const palettes = [...css.matchAll(/\{([^{}]*--page-muted:[^{}]*)\}/g)].map((match) => String(match[1]));
    assert.ok(palettes.length >= 4, `only ${palettes.length} palettes found - the sheet has changed shape`);

    for (const palette of palettes) {
      /** @param {string} token */
      const ink = (token) => {
        const found = new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`).exec(palette);
        assert.ok(found !== null, `a palette has no --${token}`);
        return String(found?.[1]);
      };
      const paper = ink("page-bg");
      const muted = ink("page-muted");
      const placeholder = ink("page-placeholder");

      const floor = contrast(placeholder, paper);
      assert.ok(floor >= 4.5, `a placeholder stands at ${floor.toFixed(2)}:1 on ${paper}, under the 4.5:1 floor`);
      // And paler than the prose beside it, or it reads as a value somebody
      // typed rather than as the hint it is.
      assert.ok(
        floor < contrast(muted, paper),
        `a placeholder is no paler than the muted ink on ${paper} (${floor.toFixed(2)}:1)`,
      );
    }
  });

  it("says it in one place, and says the opacity Firefox would dim it with", async () => {
    const css = await source("assets/page.css");
    const rule = css.slice(css.indexOf("\n::placeholder {"), css.indexOf("\n}\n", css.indexOf("\n::placeholder {")));
    assert.match(rule, /color: var\(--page-placeholder\)/, "the placeholder wears somebody else's ink");
    // Firefox dims placeholders with opacity rather than colour, and would
    // dim this one below what was measured for it.
    assert.match(rule, /opacity: 1/, "the browser is left to dim it");
  });
});
