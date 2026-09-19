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
    // A row has no air of its own (D259, S1): what stands between two rows is
    // put on below, by the rules that know whether there is a row to stand
    // between. The first and the last row of a group keep none, so a group is
    // as far from the page as its headings and blocks say and no further.
    assert.match(row, /padding-block: 0;/, "a row still carries its own outer air");

    // The headings' air comes from the header they stand in, so it is the same
    // distance whatever kind of element follows - the complaint this round
    // began with (S-a).
    assert.match(rule(css, "h2"), /margin: 0;/, "a section heading keeps an air of its own");
    assert.match(rule(css, "h3"), /margin: var\(--m-h3-before\) 0 0;/, "a subsection heading keeps an air of its own");
    assert.match(rule(css, "section > header > h2"), /margin-bottom: var\(--m-h2-after\)/, "the header does not hold the gap under a section heading");
    assert.match(rule(css, "section > header > h3"), /margin-bottom: var\(--m-h3-after\)/, "the header does not hold the gap under a subsection heading");
    assert.match(rule(css, "section > header"), /margin-bottom: var\(--m-intro-after\)/, "a header that ends in prose hands on no gap");
    assert.match(css, /section > header:has\(> h3:last-child\) \{\n  margin-bottom: var\(--m-h3-after\);/, "a heading-only header hands on the intro's gap instead of its own");
  });

  it("measures every gap between glyphs, not between line boxes (D259, S3)", async () => {
    const css = await source("options/options.css");
    const tokens = rule(css, ":root");
    /** @param {string} token */
    const gap = (token) => Number(new RegExp(`--gap-${token}: ([\\d.]+)rem;`).exec(tokens)?.[1] ?? "0");

    // Every level of grouping stands wider than the level under it (§2).
    assert.ok(gap("section") > gap("h3-before"), "a section is no further off than a subsection");
    assert.ok(gap("h3-before") > gap("row") * 2, "a subsection is no further off than two rows");
    assert.ok(gap("row") * 2 > gap("block"), "two rows stand closer than two blocks");
    assert.ok(gap("block") > gap("intro-after"), "a block stands closer than a heading's own prose");
    // A heading belongs to what stands under it: at least three times as far
    // from what came before as from what comes after (§2).
    assert.ok(gap("h3-before") >= 3 * gap("h3-after"), "a subsection heading is as far from its content as from the group above");
    // And a section heading is nearer its own content than its own rule.
    assert.ok(gap("h2-after") < gap("divider-h2"), "a section heading is nearer its rule than its content");

    // The leading is taken off every gap rather than guessed at: no margin in
    // this sheet may be a bare number of its own.
    for (const token of ["--lead-h2", "--lead-h3", "--lead-text", "--lead-small"]) {
      assert.match(tokens, new RegExp(`${token}: calc\\(\\(1\\.[0-9]+ - var\\(--ink-box\\)\\)`), `${token} is not measured off the line-height`);
    }
    for (const token of ["--m-h2-after", "--m-h3-after", "--m-block", "--m-row-top"]) {
      assert.match(tokens, new RegExp(`${token}: calc\\(var\\(--gap-`), `${token} is not a gap less its leading`);
    }
    // `text-box-trim` would say it exactly; Firefox 142 does not have it, so
    // no rule may lean on it (the comment that says so may name it).
    assert.doesNotMatch(css, /^\s*text-box-(trim|edge):/m, "the sheet leans on a property Firefox cannot read");

    // A row's first line stands in a box as tall as the touch floor, so its
    // ink begins seven pixels lower than a paragraph's would. Every gap that
    // lands on a row takes that off as well, or a heading sits 19px from its
    // own first label where §2 asks for 12 (measured in the browser).
    assert.match(tokens, /--row-extra: calc\(\(var\(--ui-control\) - var\(--ui-text\) \* 1\.45\) \/ 2\);/, "the control floor's own air is not measured");
    assert.match(tokens, /--lead-row: calc\(var\(--lead-text\) \+ var\(--row-extra\)\);/, "a row's first line is treated as a paragraph's");
    assert.match(rule(css, ".rows"), /margin: calc\(-1 \* var\(--row-extra\)\)/, "a group of rows keeps the air its controls add");
    assert.match(rule(css, ".models"), /margin: calc\(-1 \* var\(--row-extra\)\) 0 calc\(var\(--m-block\) - var\(--row-extra\)\)/, "a list keeps the air its controls add");
    // And every row begins its line at the same height, so one number covers
    // them all - including the one row that is a name and a figure.
    assert.match(rule(css, ".row:not(.row-stack) > .row-name:first-child"), /min-height: var\(--ui-control\)/, "a row of plain text begins its line higher than every other row");
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
    assert.match(rule(css, "main > section"), /margin-top: var\(--m-section\)/, "a section stands as close as a paragraph");
    // A subsection is air and weight, never a line.
    assert.doesNotMatch(rule(css, "h2"), /border/, "a section heading carries a line of its own");
    assert.doesNotMatch(rule(css, "h3"), /border/, "a subsection heading carries a line");
    assert.doesNotMatch(css, /\.rows \{\n  border-top/, "a group of rows still opens on a rule");
    assert.doesNotMatch(rule(css, ".row"), /border-bottom/, "a row still closes on a rule");
    // The hairline stands between two drawn rows and nowhere else. The general
    // sibling combinator rather than the adjacent one (D259): a row has to be
    // able to look back past the rows the search or the mode took away, or two
    // rows either side of a hidden one end up touching.
    assert.match(
      css,
      /:where\(body:not\(\.no-translation\)\) \.row:not\(\[hidden\]\) ~ \.row:not\(\[hidden\]\),\n:where\(body\.no-translation\) \.row:not\(\[hidden\], \.translation-only\) ~ \.row:not\(\[hidden\], \.translation-only\) \{\n  border-top: var\(--sep-row\);\n  padding-top: var\(--m-row-top\);/,
      "the hairline and the air are not between two drawn rows",
    );
    assert.doesNotMatch(css, /\.row \+ \.row \{/, "the hairline still leans on the adjacent combinator");
    // And the air under a row's words stands only while a drawn row follows.
    assert.match(css, /\.row:not\(\[hidden\]\):has\(~ \.row:not\(\[hidden\]\)\)/, "the last row of a group keeps air under it");
    // A dependent group opens on air alone: a hairline over its first child
    // met the line down its edge and drew a corner (K4).
    assert.match(
      css,
      /\.row:not\(\[hidden\], \.row-sub\) \+ \.row-sub:not\(\[hidden\]\) \{\n  border-top: none;\n  padding-top: 0;/,
      "a dependent group still opens on a rule",
    );
    // The long lists say the same thing without `:has()`: five hundred rows
    // re-matched on every keystroke of the filter is a cost with nothing to
    // show for it.
    assert.match(css, /\.model:not\(\[hidden\]\) ~ \.model:not\(\[hidden\]\)/, "a filtered list leaves two rows touching");
    assert.match(rule(css, ".models > :first-child"), /padding-top: 0/, "a list keeps air at its own top edge");
    assert.match(rule(css, ".models > :last-child"), /padding-bottom: 0/, "a list keeps air at its own bottom edge");
  });

  it("dresses every fold's trigger the same way, and never as a link (D259, K1)", async () => {
    const css = await source("options/options.css");
    const trigger = rule(css, "button.note-more");
    assert.match(trigger, /text-decoration: none/, "a trigger still promises a link it is not");
    assert.match(trigger, /white-space: nowrap/, "the trigger's own words can be split");
    // The hard space and the trigger stand in one box that cannot break (K2):
    // measured in the browser, the space alone let the trigger open a line of
    // its own at 49 widths out of 231, because the break opportunity a
    // browser takes is the boundary between the text and the element, not
    // the character before it.
    assert.match(rule(css, ".note-tail"), /white-space: nowrap/, "the space before a trigger is a break opportunity again");
    assert.match(css, /button\.note-more:hover,\nbutton\.note-more:focus-visible \{\n  color: var\(--page-fg\);\n  text-decoration: underline;/, "a trigger says nothing under the pointer");
    // The dictionary rows' own fold wears the page's triangle rather than the
    // browser's larger marker. Since D263 its trigger is the last word of the
    // row's second line, so the triangle rides on that word and the summary
    // around it is the whole line.
    assert.match(rule(css, "summary.dictionary-meta"), /list-style: none/, "a dictionary's fold keeps the browser's own marker");
    assert.match(css, /\.dictionary-more::before \{\n  content: "\\25B8\\00A0";/, "a dictionary's fold wears no triangle of the page's");
    assert.match(css, /\.dictionary-details\[open\] \.dictionary-more::before \{\n  content: "\\25BE\\00A0";/, "an open dictionary fold keeps the closed triangle");
    assert.match(css, /summary\.dictionary-meta:is\(:hover, :focus-visible\) \.dictionary-more \{\n  text-decoration: underline;/, "a dictionary's fold says nothing under the pointer");
  });

  it("keeps the heavier weight for headings and the section being read (D259, K3)", async () => {
    const css = await source("options/options.css");
    // Five bold dictionary names in a column outweighed the heading they
    // stand under; a date is a value, not an emphasis.
    assert.match(rule(css, ".dictionary-name"), /font-weight: 500/, "a dictionary's name is still set at a heading's weight");
    assert.match(rule(css, ".list-dated strong"), /font-weight: 400/, "the list's date is still set bold");
    // What may be 600 or more: the page's headings, the bar's own title (the
    // heading a narrow screen has) and the section being read.
    const heavy = [...css.matchAll(/\n([^\n{]+) \{[^}]*?font-weight: (600|700|bold)/g)].map((match) => String(match[1]));
    assert.deepEqual(
      heavy,
      [
        "header h1",
        "main h2",
        "main h3",
        // The two the lists brought (D263): a block's heading and a group's.
        "main h4",
        "main h5",
        '.sections a[aria-current="location"]',
        ".bar-sections",
      ],
      "something other than a heading or the section being read is set at a heading's weight",
    );
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
