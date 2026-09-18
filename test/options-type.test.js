import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The settings page's own type scale and density (D255, T2/T3). Denser than
 * the shared sheet's, because this page is a list to scan rather than a text
 * to read - the browser's own settings set their rows at about this size, and
 * beside them re/read looked enlarged.
 *
 * What is held here: that the scale lives in tokens rather than in numbers
 * scattered through the sheet, that nothing is shipped for the face, and that
 * the control floor follows the pointer without ever dropping below the
 * convention on a device read with a finger.
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

describe("the settings page's type", () => {
  it("keeps the scale in tokens, on this page alone", async () => {
    const css = await source("options/options.css");
    const tokens = rule(css, ":root");
    for (const [token, value] of /** @type {[string, string][]} */ ([
      ["--ui-h1", "1.5rem"],
      ["--ui-h2", "1.25rem"],
      ["--ui-h3", "1rem"],
      ["--ui-text", "0.9375rem"],
      ["--ui-small", "0.875rem"],
      ["--ui-control", "2.25rem"],
    ])) {
      assert.match(tokens, new RegExp(`${token}: ${value.replace(".", "\\.")};`), `${token} is not ${value}`);
    }
    // The shared sheet dresses the popup, the reader and the bubble too, and
    // this round changes none of them.
    const shared = await source("assets/page.css");
    assert.doesNotMatch(shared, /--ui-h1|--ui-text|--ui-control/, "the page's own scale leaked into the shared sheet");
  });

  it("names the system's face and ships nothing for it", async () => {
    const css = await source("options/options.css");
    assert.match(rule(css, ":root"), /--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;/, "the face is not the system's, named once");
    assert.match(rule(css, "body"), /font-family: var\(--font-ui\)/, "the page does not wear it");
    assert.doesNotMatch(css, /@font-face/, "a font is shipped with the package");
    // And the root's own size is left alone, so a browser told to render text
    // larger still does.
    assert.doesNotMatch(css, /html \{[^}]*font-size/, "the page overrides the browser's own text size");
  });

  it("sizes every heading and every quiet line from the scale", async () => {
    const css = await source("options/options.css");
    assert.match(rule(css, "header h1"), /font-size: var\(--ui-h1\)/, "the title is off the scale");
    assert.match(rule(css, "main h2"), /font-size: var\(--ui-h2\)/, "a section heading is off the scale");
    assert.match(rule(css, "main h3"), /font-size: var\(--ui-h3\)/, "a subsection heading is off the scale");
    assert.match(rule(css, ".row .row-note"), /font-size: var\(--ui-small\)/, "a row's description is off the scale");
    assert.match(rule(css, ".sections a"), /font-size: var\(--ui-text\)/, "the table of contents is off the scale");
    assert.match(rule(css, ".bar-sections"), /font-size: var\(--ui-h3\)/, "the bar's title is off the scale");
    // No stray sizes left behind: every one of them went into a token.
    assert.doesNotMatch(css, /font-size: 0\.9rem;|font-size: 0\.95rem;/, "a size stands outside the scale");
  });

  it("floors every control on the pointer, and never under the convention on a finger", async () => {
    const css = await source("options/options.css");
    assert.match(rule(css, ".row select"), /min-height: var\(--ui-control\)/, "a select keeps a size of its own");
    assert.match(rule(css, ".row button"), /min-height: var\(--ui-control\)/, "a button keeps a size of its own");
    assert.match(rule(css, ".row-toggle"), /min-height: var\(--ui-control\)/, "the clickable line of a checkbox keeps a size of its own");
    // `any-pointer`, not `pointer`: a Boox with a pen answers `pointer: fine`
    // and is still read with a finger.
    assert.match(
      css,
      /@media \(any-pointer: coarse\) \{\s*:root \{\s*--ui-control: 2\.75rem;/,
      "the 44px floor does not come back on a device read with a finger",
    );
    assert.doesNotMatch(css, /@media \(pointer: coarse\)/, "the floor is decided by a query a Boox answers wrongly");
    // The bar is the one exception, and says why beside itself.
    const field = rule(css, ".settings-search input");
    assert.match(field, /min-height: 2\.1rem/, "the bar's field does not keep the bar's own floor");
  });

  it("puts a row's description under its label rather than in the row's air", async () => {
    const css = await source("options/options.css");
    const row = rule(css, ".row");
    assert.match(row, /gap: 0\.125rem 1rem/, "the description floats away from the label it belongs to");
    assert.match(row, /padding-block: 0\.75rem/, "the row keeps its old height");
    // The headings' air is the scale's, not the shared sheet's.
    assert.match(rule(css, "h2"), /margin-top: 2\.5rem/, "a section heading keeps its old air");
    assert.match(rule(css, "h3"), /margin-top: 1\.5rem/, "a subsection heading keeps its old air");
  });
});
