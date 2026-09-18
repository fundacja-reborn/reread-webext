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
      ["--ui-h3", "1.0625rem"],
      ["--ui-text", "0.9375rem"],
      ["--ui-small", "0.8125rem"],
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
    // The class, not the row: the same note stands under the copies block,
    // which is in no row - and was therefore drawn at the page's full size.
    assert.match(rule(css, ".row-note"), /font-size: var\(--ui-small\)/, "a row's description is off the scale");
    assert.match(rule(css, "p.explain,\n.hint"), /font-size: var\(--ui-small\)/, "a section's opening paragraph is off the scale");
    assert.match(rule(css, ".sections a"), /font-size: var\(--ui-text\)/, "the table of contents is off the scale");
    assert.match(rule(css, ".bar-sections"), /font-size: var\(--ui-h3\)/, "the bar's title is off the scale");
    // No stray sizes left behind: every one of them went into a token. The
    // badge's 0.75rem is the one exception and says why beside itself; `code`
    // adjusts in `em`, which follows whatever it is set inside.
    assert.doesNotMatch(css, /font-size: 0\.9rem;|font-size: 0\.95rem;|font-size: 0\.85rem;/, "a size stands outside the scale");
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
    // The headings' air comes from the space tokens, and every gap before a
    // heading is at least twice the gap after it (D258, §3.1): a heading
    // belongs to what stands under it.
    assert.match(rule(css, "h2"), /margin-bottom: var\(--space-after-h2\)/, "a section heading keeps its old air");
    assert.match(rule(css, "h3"), /margin-top: var\(--space-before-h3\)/, "a subsection heading keeps its old air");
    assert.match(rule(css, "h3"), /margin-bottom: var\(--space-after-h3\)/, "a subsection heading crowds what it opens");
    const tokens = rule(css, ":root");
    for (const [before, after] of /** @type {[string, string][]} */ ([
      ["--space-section", "--space-after-h2"],
      ["--space-before-h3", "--space-after-h3"],
    ])) {
      /** @param {string} token */
      const read = (token) => Number(new RegExp(`${token}: ([\\d.]+)rem;`).exec(tokens)?.[1] ?? "0");
      assert.ok(read(before) >= 2 * read(after), `${before} is not twice ${after}`);
    }
  });

  it("gives a section, a subsection and a row three different boundaries (D258, H1)", async () => {
    const css = await source("options/options.css");
    const tokens = rule(css, ":root");
    // The strong ink is the controls' border token, over 3:1 against the
    // paper in every theme; the subtle one is the separators' own.
    assert.match(tokens, /--sep-section: 2px solid var\(--page-border\);/, "a section's rule is not the strong one");
    assert.match(tokens, /--sep-row: 1px solid var\(--page-line\);/, "a row's hairline is not the separators' own");
    // The rule belongs to the section, so it never travels into a fold or a
    // card that borrows a heading's element.
    assert.match(rule(css, "main > section"), /border-top: var\(--sep-section\)/, "a section has no boundary of its own");
    assert.match(rule(css, "main > section"), /margin-top: var\(--space-section\)/, "a section stands as close as a paragraph");
    // A subsection is air and weight, never a line.
    assert.doesNotMatch(rule(css, "h2"), /border/, "a section heading carries a line of its own");
    assert.doesNotMatch(rule(css, "h3"), /border/, "a subsection heading carries a line");
    assert.doesNotMatch(css, /\.rows \{\n  border-top/, "a group of rows still opens on a rule");
    assert.doesNotMatch(rule(css, ".row"), /border-bottom/, "a row still closes on a rule");
    // The hairline stands between two drawn rows and nowhere else - a row
    // whose predecessor left the page hands the line back.
    assert.match(css, /\.row \+ \.row,\n\.model \+ \.model,\n\.dictionary-row \+ \.dictionary-row \{\n  border-top: var\(--sep-row\);/, "the hairline is not between two rows");
    assert.match(css, /\[hidden\] \+ :is\(\.row, \.model, \.dictionary-row\)/, "a row after a hidden one opens on a stray rule");
    assert.match(css, /body\.no-translation \.translation-only \+ \.row/, "the mode leaves a stray rule over its first row");
  });

  it("keeps one note on the page, and the accent for the one block that asks to be acted on (D258, H2)", async () => {
    const css = await source("options/options.css");
    const note = rule(css, ".note");
    assert.match(note, /border-inline-start: 3px solid var\(--page-border\)/, "the note's edge is not the strong ink");
    assert.doesNotMatch(note, /var\(--page-accent\)/, "a note nobody has to act on wears the accent");
    assert.match(note, /font-size: var\(--ui-small\)/, "the note speaks at its own size");
    // The footnote's own rule in page.css is the more specific one, so the
    // edge has to be said again here or it falls back to the hairline.
    assert.match(rule(css, ".note.footnote"), /border-left-color: var\(--page-border\)/, "a footnote's edge falls back to the hairline");
    // The one exception, and it is the card with three things to do in it.
    assert.match(rule(css, ".first-steps"), /border-left-color: var\(--page-accent\)/, "the first steps lost the accent that marks them");
  });

  it("dresses a fold as an action rather than as a heading (D258, V1)", async () => {
    const css = await source("options/options.css");
    const heading = rule(css, ".fold summary h3");
    assert.match(heading, /font-size: var\(--ui-text\)/, "a fold still reads at a subsection's size");
    assert.match(heading, /font-weight: 500/, "a fold still reads at a subsection's weight");
    // The page's own triangle, the one the row notes' More wears - never a
    // chevron (D254 §2.6), and never a turn that an e-ink panel would smear.
    assert.match(css, /\.fold > summary::before \{\n  content: "\\25B8\\00A0";/, "a fold wears no marker of the page's own");
    assert.match(css, /\.fold\[open\] > summary::before \{\n  content: "\\25BE\\00A0";/, "an open fold keeps the closed marker");
    assert.match(rule(css, ".fold > summary"), /min-height: var\(--ui-control\)/, "a fold is under the touch floor");
    // "Show all (N)" unfolds a list the way these unfold a form, so it is
    // dressed the same.
    assert.match(rule(css, ".show-all"), /font-size: var\(--ui-text\)/, "the list's fold is dressed unlike the others");
    assert.match(css, /\.show-all\[aria-expanded="true"\]::before/, "the list's fold never turns its triangle");
    // And nothing after the first fold opens a gap: they are a list of doors.
    assert.match(rule(css, ".fold + .fold"), /margin-top: 0/, "two folds stand a block apart");
  });
});
