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
      // Two sizes on the page and no third (Michał, 2026-09-19), at the
      // size a browser's own settings are set in: the rows' own, and the
      // small print that explains them.
      ["--ui-text", "0.8125rem"],
      ["--ui-small", "0.75rem"],
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
    // The checkbox row's floor is the row's own (D265): the box no longer
    // stands on a line of its own, so the row is what has to be pressable.
    assert.match(rule(css, ":is(.card, .rows, .card-list, .models) > *"), /min-height: var\(--row-min-h\)/, "a row keeps no floor of its own");
    assert.match(rule(css, ".row-check > input[type=\"checkbox\"]"), /width: var\(--row-box\)/, "the box is not drawn at the size the indent is measured from");
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

  it("gives every row of every card one box, and the heading over it its own air", async () => {
    const css = await source("options/options.css");
    const row = rule(css, ".row");
    assert.match(row, /gap: 0\.125rem 1rem/, "the description floats away from the label it belongs to");

    // One geometry for every kind of row, whatever stands in it (D265): the
    // card's own children take the padding and the floor, and the wrappers
    // inside a card - a list, a group, a fold, the copies' table - hand the
    // box straight back to the rows they hold.
    assert.match(
      css,
      /:is\(\.card, \.rows, \.card-list, \.models\) > \* \{\n  position: relative;\n  margin: 0;\n  min-height: var\(--row-min-h\);\n  padding: var\(--row-pad-y\) var\(--row-pad-x\);/,
      "a row of a card keeps a box of its own",
    );
    assert.match(
      css,
      /:is\(\.card, \.rows, \.card-list\) > :is\(\.rows, \.models, \.card-list, details, table\) \{\n  min-height: 0;\n  padding: 0;/,
      "a wrapper inside a card is drawn as a row",
    );

    // The headings' air comes from the header they stand in, so it is the
    // same distance whatever kind of element follows - the rule D259 found
    // and D265 keeps, said in margins now that the rows have padding.
    assert.match(rule(css, "h2"), /margin: 0;/, "a section heading keeps an air of its own");
    assert.match(rule(css, "h3"), /margin: 0;/, "a subsection heading keeps an air of its own");
    assert.match(rule(css, "section > header"), /margin: 0 0 var\(--gap-h2-after\)/, "the header does not hold the gap under a heading");
    assert.match(
      css,
      /section > header:has\(> h3\) \{\n  margin-top: var\(--gap-h3-before\);\n  margin-bottom: var\(--gap-h3-after\);/,
      "a subsection stands as close to what it follows as a section does",
    );
    assert.match(rule(css, "main > section"), /margin-top: var\(--gap-section\)/, "a section stands as close as a paragraph");
  });

  it("keeps the air around the cards in tokens, every level wider than the one under it (D265)", async () => {
    const css = await source("options/options.css");
    const tokens = rule(css, ":root");
    /** @param {string} token */
    const gap = (token) => Number(new RegExp(`--gap-${token}: ([\\d.]+)rem;`).exec(tokens)?.[1] ?? "0");

    // A section stands further off than a subsection, a subsection further
    // than a heading holds its own cards, and one card from the next is the
    // smallest gap of all.
    assert.ok(gap("section") > gap("h3-before"), "a section is no further off than a subsection");
    assert.ok(gap("h3-before") > gap("h2-after"), "a subsection is no further off than a heading's own cards");
    assert.ok(gap("h2-after") >= gap("card"), "two cards stand further apart than a heading from its first");
    // A heading belongs to what stands under it: at least twice as far from
    // what came before as from what comes after.
    assert.ok(gap("h3-before") >= 2 * gap("h3-after"), "a subsection heading is as far from its content as from the group above");

    // The geometry of a row is tokens too, and in rem: a browser told to
    // render text larger grows the rows with it.
    for (const [token, value] of /** @type {[string, string][]} */ ([
      ["--row-pad-x", "1.25rem"],
      ["--row-pad-y", "0.75rem"],
      ["--row-min-h", "3rem"],
      ["--settings-column-width", "42.5rem"],
    ])) {
      assert.match(tokens, new RegExp(`${token}: ${value.replace(".", "\\.")};`), `${token} is not ${value}`);
    }
    // The touch floor the convention asks for, kept by the rows themselves.
    assert.ok(Number(/--row-min-h: ([\d.]+)rem;/.exec(tokens)?.[1] ?? "0") * 16 >= 44, "a row is under the 44px floor");
    // The indent a description and a dependent row begin at is the checkbox's
    // own column, not a number somebody picked.
    assert.match(tokens, /--row-indent: calc\(var\(--row-box\) \+ var\(--row-gap\)\);/, "the indent is not the checkbox's own column");
    // The machinery D259 needed for a page with no cards is gone with it: no
    // margin on this page is a gap less two half-leadings any more.
    assert.doesNotMatch(css, /--lead-h2|--ink-box|--row-extra/, "the flat page's leading arithmetic is still here");
    assert.doesNotMatch(css, /^\s*text-box-(trim|edge):/m, "the sheet leans on a property Firefox cannot read");
  });

  it("draws one boundary for a group and one for a row, and nothing else (D265)", async () => {
    const css = await source("options/options.css");
    const tokens = rule(css, ":root");
    // The card's frame and the hairline between two rows are the page's two
    // boundaries. The 2px section rule D258 needed for a flat page is gone:
    // a card is a stronger boundary than any line.
    //
    // On glass both are a shade of the page, which is what the browser's own
    // settings look like (Michał's revision of D3, 2026-09-19); the e-ink
    // paper, a theme of its own, takes the separators' solid grey instead -
    // the block below holds both halves of that.
    assert.match(tokens, /--settings-card-border: #dfe1e6;/, "the card's frame is not a shade of the page");
    assert.match(tokens, /--sep-row: 1px solid var\(--settings-separator\);/, "a row's hairline is not the separator token");
    assert.doesNotMatch(css, /--sep-section/, "the flat page's section rule is still here");
    assert.doesNotMatch(rule(css, "main > section"), /border-top/, "a section still opens on a rule");
    assert.doesNotMatch(rule(css, "h2"), /border/, "a section heading carries a line of its own");
    assert.doesNotMatch(rule(css, "h3"), /border/, "a subsection heading carries a line");

    // The frame carries the card, not the shadow: on a Boox the tinted page
    // quantizes to white and no shadow is rendered at all.
    const card = rule(css, ".card");
    assert.match(card, /border: 1px solid var\(--settings-card-border\)/, "a card has no frame of its own");
    assert.match(card, /background: var\(--settings-card-bg\)/, "a card is not raised over the page");
    assert.match(card, /overflow: hidden/, "the first and last rows' wash is not clipped to the card's corners");
    assert.match(card, /container-type: inline-size/, "a row cannot ask how wide its own card is");
    // And on e-ink the tone goes, the shadow goes, and the frame becomes the
    // separators' own solid grey - the only thing left holding the card.
    assert.match(
      css,
      /:root\[data-reader-theme="eink"\] \{\n  --settings-page-bg: #ffffff;\n  --settings-card-bg: #ffffff;\n  --settings-card-border: var\(--page-line\);\n  --settings-separator: var\(--page-line\);\n  --settings-card-shadow: none;/,
      "the e-ink paper keeps a tone it cannot draw, or loses the frame that carries its cards",
    );
    // Every paper this page has says both for itself, so a light theme chosen
    // by hand on a dark browser cannot end up with the dark frame. Sepia is
    // not one of them: the settings do not wear that paper at all (D265).
    assert.doesNotMatch(css, /data-reader-theme="sepia"/, "the settings dress themselves in a paper they do not have");
    for (const theme of ["light", "dark", "eink"]) {
      const block = rule(css, `:root[data-reader-theme="${theme}"]`);
      assert.match(block, /--settings-card-border:/, `${theme} inherits a frame from another paper`);
      assert.match(block, /--settings-separator:/, `${theme} inherits a hairline from another paper`);
    }

    // The hairline stands on a row that has a drawn row before it - never
    // under the row above, which the search would leave hanging - and it is
    // inset from both edges by the row's own padding. `~` rather than `+`, so
    // a row can look back past the rows a query took away.
    assert.match(
      css,
      /:is\(\.card, \.rows, \.card-list, \.models\)\n  > :where\(:not\(\[hidden\], \.status:empty\)\)\n  ~ :where\(:not\(\[hidden\], \.status:empty\)\)::after \{\n  content: "";\n  position: absolute;\n  top: 0;\n  inset-inline: var\(--row-pad-x\);\n  border-top: var\(--sep-row\);/,
      "the hairline is not drawn between two drawn rows, inset from the card's edges",
    );
    assert.doesNotMatch(css, /\.row \+ \.row \{/, "the hairline leans on the adjacent combinator");
    // A card's label draws the line above itself and never one under it.
    assert.match(
      css,
      /:is\(\.card, \.rows, \.card-list, \.models\) > \.card-head \+ \*::after \{\n  content: none;/,
      "a card's label parts itself from what it names",
    );
    // An empty status draws no box, so it is no row either - counted, it
    // would open a card on a line with nothing over it.
    assert.match(
      css,
      /:is\(\.card, \.rows, \.card-list, \.models\) > \.status::after \{\n  content: none;/,
      "a status is parted from the row it answers",
    );
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
    // The dictionary rows' own fold is the page's own, and says so by wearing
    // its class: the triangle, the quiet ink, the underline under a pointer
    // and the turn on opening all come from `button.note-more` (Michał's
    // second round - one dress for every fold on the page).
    const script = await source("options/options.js");
    assert.match(script, /more\.className = "note-more dictionary-more"/, "a dictionary's fold is dressed on its own");
    assert.doesNotMatch(css, /summary\.dictionary-meta/, "a dictionary's fold is still a summary of its own");
  });

  it("keeps the heavier weight for headings and the section being read (D259, K3)", async () => {
    const css = await source("options/options.css");
    // Five bold dictionary names in a column outweighed the heading they
    // stand under (D259); since Michał's second round on the panels they are
    // not even half a step heavier - a card holds one size and one weight.
    // A date is a value, not an emphasis, and was never bold either.
    assert.match(rule(css, ".dictionary-name"), /font-weight: var\(--ui-label-weight\)/, "a dictionary's name is set apart from the labels around it");
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
        // The two the lists brought (D263), which since D265 stand inside the
        // cards as their labels.
        "main h4",
        "main h5",
        '.sections a[aria-current="location"]',
        ".bar-sections",

      ],
      "something other than a heading or the section being read is set at a heading's weight",
    );
    // And inside a card there is one size and one weight for every row
    // (Michał's second round): the card's own label is the only thing that
    // takes half a step, at the small print's size, so it can never outweigh
    // the heading standing over the card.
    assert.match(rule(css, ".card-head"), /font-size: var\(--ui-text\);\n  font-weight: 500;/, "a card's label is set apart from the rows it labels");
    // What a row holds is one size, whatever kind of thing it is: a name, a
    // figure, the quiet Delete beside them.
    for (const selector of [".model-meta", "button.model-delete", ".copies"]) {
      assert.match(rule(css, selector), /font-size: var\(--ui-text\)/, `${selector} is set apart from the rows it stands in`);
    }
    for (const selector of [".dictionary-name", ".show-all", ".fold summary h3"]) {
      assert.match(rule(css, selector), /font-weight: var\(--ui-label-weight\)/, `${selector} is set heavier than the labels around it`);
    }
  });

  it("says a note in a row and keeps the frame for the one warning (D265, D4)", async () => {
    const css = await source("options/options.css");
    // Where a download comes from, what an address field takes, what the
    // order of a list means: quiet prose in a row of its card, with no wash,
    // no frame and no bar down its edge. Both of page.css's own dresses have
    // to be said back to nothing here.
    const note = rule(css, ".note,\n.note.footnote");
    assert.match(note, /border: none/, "a note still wears a frame inside a card");
    assert.match(note, /background: none/, "a note still wears a wash inside a card");
    assert.match(note, /font-size: var\(--ui-small\)/, "the note speaks at its own size");
    // One framed box on the page: the warning about what an uninstall takes.
    const warning = rule(css, ".note-warning");
    assert.match(warning, /border: 1px solid var\(--page-line\)/, "the one warning lost its frame");
    // And the sentence a private window opens on, which stands on no card.
    assert.match(rule(css, ".note.private-note"), /border-inline-start: 3px solid var\(--page-accent\)/, "the private-window note lost its edge");
    // The first steps keep the accent: the one block on the page that asks to
    // be acted on.
    assert.match(rule(css, ".first-steps"), /var\(--page-accent\)/, "the first steps lost the accent that marks them");
  });

  it("dresses a fold as an action rather than as a heading (D258, V1)", async () => {
    const css = await source("options/options.css");
    const heading = rule(css, ".fold summary h3");
    assert.match(heading, /font-size: var\(--ui-text\)/, "a fold still reads at a subsection's size");
    assert.match(heading, /font-weight: var\(--ui-label-weight\)/, "a fold reads heavier than the rows around it");
    // The page's own triangle, the one the row notes' More wears - never a
    // chevron (D254 §2.6), and never a turn that an e-ink panel would smear.
    assert.match(css, /\.fold > summary::before \{\n  content: "\\25B8\\00A0";/, "a fold wears no marker of the page's own");
    assert.match(css, /\.fold\[open\] > summary::before \{\n  content: "\\25BE\\00A0";/, "an open fold keeps the closed marker");
    // A fold is a row of its card since D265, so its floor is the rows'.
    assert.match(rule(css, ".fold > summary"), /min-height: var\(--row-min-h\)/, "a fold is under the touch floor");
    assert.match(rule(css, ".fold > summary"), /padding: var\(--row-pad-y\) var\(--row-pad-x\)/, "a fold's door is not a row of its card");
    // "Show all (N)" unfolds a list the way these unfold a form, so it is
    // dressed the same - the rows' own size and the rows' own weight.
    assert.match(rule(css, ".show-all"), /font-size: var\(--ui-text\)/, "the list's fold is dressed unlike the others");
    assert.match(css, /\.show-all\[aria-expanded="true"\]::before/, "the list's fold never turns its triangle");
    // And nothing after the first fold opens a gap: they are a list of doors,
    // which since D265 means a list of rows in one card.
    assert.match(rule(css, ".fold"), /margin: 0;/, "a fold keeps an air of its own inside its card");
  });
});
