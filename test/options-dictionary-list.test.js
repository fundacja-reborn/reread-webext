import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The list of dictionaries on the settings page (the seventh brief, rebuilt
// in D263): what the smoke test cannot count and the eye cannot measure - the
// shape every row is built in, the groups it stands in, the one narrow-screen
// move, the ink of a disabled arrow, where the focus goes after a move. Read
// from the sources, since the page only exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/options/options.css"), "utf8");
const script = readFileSync(join(ROOT, "src/options/options.js"), "utf8");
const page = readFileSync(join(ROOT, "src/options/options.html"), "utf8");

/**
 * The declarations of one rule, found by its selector line.
 *
 * @param {string} sheet
 * @param {string} selector
 * @returns {string}
 */
function rule(sheet, selector) {
  const at = sheet.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

/**
 * The body of one function of the settings script, from its name to the
 * next one's.
 *
 * @param {string} name
 * @param {string} next
 * @returns {string}
 */
function fn(name, next) {
  const from = script.indexOf(`function ${name}(`);
  const to = script.indexOf(`function ${next}(`);
  assert.ok(from >= 0 && to > from, `${name} before ${next}`);
  return script.slice(from, to);
}

describe("the dictionary list's rows", () => {
  it("are items of a list, the browser's bullets and indent taken off", () => {
    // What is here stands in one list per language, inside the block's own
    // box; the catalogue below keeps its single list.
    // The wrapper carries the class the card's hairlines are drawn from
    // (D265): its own children are the groups, and the groups' the rows.
    assert.match(page, /<div id="dictionary-list" class="card-list"><\/div>/);
    assert.match(page, /<ul id="dictionary-catalog" class="models"><\/ul>/);
    assert.match(fn("renderDictionaryList", "renderCatalog"), /element\("ul", "models"\)/);
    assert.match(script, /element\("li", "dictionary-row"\)/);
    assert.match(rule(css, "ul.models"), /list-style: none/);
    assert.match(rule(css, "ul.models"), /padding: 0/);
    // The empty line and the "no match" line stand in the list as items too.
    assert.match(script, /element\("li", "empty", t\("options_no_catalog"\)\)/);
  });

  it("stand on one line at every width: the name, the door, the buttons (Michał, 2026-09-19)", () => {
    const row = fn("renderDictionary", "refreshRowName");
    const order = [
      'element("div", "dictionary-head")',
      'element("p", "dictionary-name", shown)',
      'element("div", "dictionary-body")',
      'element("p", "dictionary-meta")',
    ].map((mark) => row.indexOf(mark));
    assert.ok(order.every((at) => at >= 0), "every line is built");
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    // The pair is gone from the row: its own language is the heading above
    // it, and the language it explains into opens the small print.
    assert.doesNotMatch(row, /dictionaryRow\(/, "the row still opens on the pair");
    // No grid anywhere in the row: a wrapping flex line for the head, the
    // rest in the page's own flow.
    assert.doesNotMatch(rule(css, ".dictionary-row"), /grid/);
    assert.match(rule(css, ".dictionary-head"), /display: flex;\s+flex-wrap: wrap/);
    // The catalogue's rows and the download-in-progress row keep the pair -
    // there is no name yet to call them by.
    assert.match(fn("renderCatalogRow", "emptyList"), /dictionaryRow\(entry\.from, entry\.to\)/);
    assert.match(fn("renderFetching", "downloadDictionary"), /element\("div", "dictionary-head"\)/);
    assert.match(page, /<div id="dictionary-link-row" class="dictionary-row" hidden><\/div>/);
  });

  it("keep the door on the name's own line, in the page's one fold dress", () => {
    const row = fn("renderDictionary", "refreshRowName");
    // The page's own fold - a trigger and the paragraph it names - rather
    // than a `<details>`: every other fold on this page is built that way,
    // and the door has to stand on the row's first line, which a summary
    // wrapping the whole row cannot do.
    assert.match(row, /more\.className = "note-more dictionary-more"/);
    assert.match(row, /more\.setAttribute\("aria-controls", body\.id\)/);
    assert.match(row, /armMore\(more, body\)/);
    assert.match(row, /head\.append\(more\)/);
    // And it is named for the book it opens: a column of triggers all saying
    // "Details" names none of them.
    assert.match(row, /t\("options_dictionary_details_aria", shown\)/);
    // The trigger never wraps away from the name it belongs to.
    assert.match(rule(css, ".dictionary-more"), /flex: none/);
    // The small print is what the fold opens, not what it hangs off.
    const meta = fn("fillDictionaryMeta", "renderDictionary");
    assert.doesNotMatch(meta, /note-tail|options_details/);
  });

  it("never break the pair in the middle, and let the badge wrap instead", () => {
    assert.match(rule(css, ".dictionary-pair"), /white-space: nowrap/);
    // Only a pair wider than the whole row is cut, rather than scrolling the page sideways.
    assert.match(rule(css, ".dictionary-pair"), /text-overflow: ellipsis/);
    assert.doesNotMatch(rule(css, ".dictionary-head .badge"), /nowrap/);
  });

  it("keep the buttons in one group at the right edge, under the name only in a narrow card", () => {
    const actions = rule(css, ".dictionary-actions");
    assert.match(actions, /flex: none/);
    assert.match(actions, /margin-left: auto/);
    assert.match(rule(css, ".dictionary-actions button"), /white-space: nowrap/);
    // The card asks its own width, not the window's (D265): a card is 42.5rem
    // on a desktop whatever the window does, and a phone's width on a phone.
    // There the name takes the line to itself and everything that acts on it
    // - the door to the details included - stands on the next one, flush
    // right: a name and four controls never fit on one line of a phone.
    const narrow = css.slice(css.indexOf("@container (max-width: 30rem)"));
    assert.match(narrow, /\.dictionary-name \{\n    flex-basis: 100%;\n  \}/);
    assert.match(narrow, /\.dictionary-actions \{\n    justify-content: flex-end;\n    margin-left: auto;/);
    // And no window-width rule reaches the dictionary row at all: the stack
    // is the same everywhere, and what changes is the card's own width.
    for (let at = css.indexOf("@media (max-width"); at >= 0; at = css.indexOf("@media (max-width", at + 1)) {
      let depth = 0;
      let end = css.indexOf("{", at);
      for (let i = end; i < css.length; i += 1) {
        if (css[i] === "{") depth += 1;
        if (css[i] === "}") depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      assert.doesNotMatch(css.slice(at, end), /\.dictionary/, "a window-width rule reaches the dictionary row");
    }
  });

  it("title the row with the shown name and wrap it rather than cut it", () => {
    assert.match(fn("renderDictionary", "refreshRowName"), /element\("p", "dictionary-name", shown\)/);
    const title = rule(css, ".dictionary-name");
    assert.match(title, /overflow-wrap: anywhere/);
    assert.doesNotMatch(title, /text-overflow|nowrap|line-clamp/);
  });

  it("open the small print with the language the book explains into, and keep a count whole", () => {
    const meta = fn("fillDictionaryMeta", "renderDictionary");
    assert.match(meta, /dictionary\.langFrom === dictionary\.langTo/);
    assert.match(meta, /t\("options_dictionary_monolingual"\)/);
    assert.match(meta, /t\("options_dictionary_into", languageName\(dictionary\.langTo\)\)/);
    // The items apart by a middle dot after a no-break space: a line may end
    // after the dot, never begin with it.
    assert.match(meta, /meta\.append\("\\u00a0· "\)/);
    assert.match(meta, /element\("span", "dictionary-count", words\(dictionary\.entryCount\)\)/);
    assert.match(meta, /element\("span", "dictionary-count", megabytes\(dictionary\.bytes\)\)/);
    assert.match(rule(css, ".dictionary-count"), /white-space: nowrap/);
    assert.match(rule(css, ".dictionary-meta"), /overflow-wrap: anywhere/);
    // What the line handed over to the fold (D263): the file's name and the
    // count of other spellings.
    assert.doesNotMatch(meta, /dictionary-file"|spellings/);
    const row = fn("renderDictionary", "refreshRowName");
    assert.match(row, /if \(dictionary\.aliasCount > 0\) \{/);
  });
});

describe("the groups the list stands in (D263, L2)", () => {
  it("are the language whose words a dictionary explains - the one the arrows can mean anything in", () => {
    const groups = fn("dictionaryGroups", "dictionaryGroupHeading");
    assert.match(groups, /byLanguage\.get\(dictionary\.langFrom\)/, "the grouping is not by the language of the headwords");
    // The language being read first, the rest by name in the page's language.
    assert.match(groups, /group\.lang === config\.sourceLang \? 0 : 1/);
    assert.match(groups, /new Intl\.Collator\(uiLocale\(\)\)/);
    assert.match(groups, /collator\.compare\(one\.name, two\.name\)/);
  });

  it("wear the badge of what is being read on the heading, not on the rows", () => {
    const heading = fn("dictionaryGroupHeading", "renderDictionaryList");
    // The heading is the card's own label (D265), so it wears that class too.
    assert.match(heading, /element\("h5", "dictionary-group card-head", group\.name\)/);
    assert.match(heading, /group\.lang === config\.sourceLang/);
    assert.match(heading, /t\("options_badge_reading"\)/);
    // A stored row carries none of its own any more: the pill said "what you
    // are reading" of the rows whose target language matched the pair, and
    // said nothing of a monolingual book of the very language being read.
    assert.doesNotMatch(fn("renderDictionary", "refreshRowName"), /options_badge_reading/);
  });

  it("stand only where there is more than one language to tell apart", () => {
    const list = fn("renderDictionaryList", "renderCatalog");
    assert.match(list, /if \(groups\.length > 1\) list\.append\(dictionaryGroupHeading\(group\)\)/);
    // And a group's heading is the card's own label (D265): the rows' own
    // size in the quiet ink, a label's weight, and the hairline drawn over it
    // rather than under.
    assert.match(rule(css, ".card-head"), /font-size: var\(--ui-text\)/);
    assert.match(css, /:is\(\.card, \.rows, \.card-list, \.models\) > \.card-head \+ \*::after \{\n  content: none;/);
  });
});

describe("the arrows", () => {
  it("are drawn, not typed, so every system shows the same arrow", () => {
    // The typed arrows are the system font's to shape, and Android's have a
    // head too small to read (Michał's Pixel, 2026-09-20). The button is
    // handed a drawing, and neither character may come back as its label.
    const button = fn("moveButton", "moveLabel");
    assert.match(button, /button\.append\(moveIcon\(step\)\)/);
    assert.doesNotMatch(button, /textContent/);
    for (const typed of [0x2191, 0x2193]) {
      assert.ok(!script.includes(String.fromCodePoint(typed)), `U+${typed.toString(16)} typed in the settings script`);
    }

    // One drawing per direction, in the button's own ink - which is what
    // lets the resting, hover and disabled colours dress it with no rule of
    // their own - and silent to assistive tech, since the button's
    // accessible name already says which dictionary moves where.
    const icon = fn("moveIcon", "moveButton");
    assert.match(icon, /step < 0 \? "M8 13\.25V3\.1M4\.05 7\.05 8 3\.1l3\.95 3\.95" : "M8 2\.75V12\.9M4\.05 8\.95 8 12\.9l3\.95-3\.95"/);
    assert.match(icon, /setAttribute\("stroke-width", "1\.3"\)/);
    assert.match(icon, /setAttribute\("stroke", "currentColor"\)/);
    assert.match(icon, /setAttribute\("fill", "none"\)/);
    assert.match(icon, /setAttribute\("aria-hidden", "true"\)/);
    assert.doesNotMatch(icon, /innerHTML/);

    // Sized from the row's text, so it grows with it under a finger, and
    // centred in a button that no longer has a baseline to offer it. The
    // factor is the measured one: at 1.32 the drawing is the arrow macOS
    // typed at the button's old size - 12.3px tall, a 1.4px stroke beside 13px
    // words - where 1.6 made it a fifth larger and heavier than the row
    // around it (Michał, 2026-09-20).
    const size = rule(css, ".move-icon");
    assert.match(size, /width: calc\(var\(--ui-text\) \* 1\.32\)/);
    assert.match(size, /height: calc\(var\(--ui-text\) \* 1\.32\)/);
    const box = 13 * 1.32;
    const tall = ((13.25 - 3.1 + 1.3) * box) / 16;
    const stroke = (1.3 * box) / 16;
    const wide = ((3.95 * 2 + 1.3) * box) / 16;
    assert.ok(Math.abs(tall - 12.3) < 0.1, "the arrow is " + tall.toFixed(2) + "px tall beside 13px words");
    assert.ok(Math.abs(stroke - 1.4) < 0.05, "its stroke is " + stroke.toFixed(2) + "px");
    assert.ok(Math.abs(wide - 9.9) < 0.1, "its head is " + wide.toFixed(2) + "px wide");
    const dress = rule(css, "button.model-move");
    assert.match(dress, /display: inline-flex/);
    assert.match(dress, /align-items: center/);
    assert.match(dress, /justify-content: center/);
    assert.doesNotMatch(dress, /font-size/);
  });

  it("wear the separator lines' ink when disabled, not a thinner version of their own", () => {
    const disabled = rule(css, ".model-move:disabled,\n.model-move:disabled:hover");
    assert.match(disabled, /color: var\(--page-line\)/);
    assert.doesNotMatch(disabled, /opacity: 0\./);
    // Said in the attribute as well as the state.
    assert.match(fn("moveButton", "moveLabel"), /if \(button\.disabled\) button\.setAttribute\("aria-disabled", "true"\)/);
  });

  it("move a dictionary within its own language, and count it within its own group", () => {
    const move = fn("moveDictionary", "renameField");
    assert.match(move, /moveWithinSourceLanguage\(dictionaryPlaces, dictionary\.id, step\)/);
    // "Third of three, English" - the place in the group on screen, never in
    // the one list the database keeps.
    assert.match(move, /dictionaryPlaces\.filter\(\(one\) => one\.lang === dictionary\.langFrom\)/);
    assert.match(move, /languageName\(dictionary\.langFrom\)/);
  });

  it("stay in place at the ends of a group rather than vanishing", () => {
    // Both arrows are built whenever there is anything to arrange; only
    // their enabled state changes with the row's place in its group.
    const row = fn("renderDictionary", "refreshRowName");
    assert.match(row, /moveButton\(dictionary, -1, place\.at > 0\)/);
    assert.match(row, /moveButton\(dictionary, 1, place\.at < place\.total - 1\)/);
    const list = fn("renderDictionaryList", "renderCatalog");
    assert.match(list, /\{ at, total: group\.dictionaries\.length \}/);
  });

  it("keep the focus on the arrow that moved with its row, or the opposite one at the end", () => {
    const focus = fn("focusMove", "moveDictionary");
    assert.match(focus, /moveButtonFor\(id, step\)/);
    assert.match(focus, /moveButtonFor\(id, -step\)/);
    assert.match(fn("moveDictionary", "renameField"), /focusMove\(dictionary\.id, step\)/);
    // And it looks for it in the list of what is here, not in the catalogue.
    assert.match(fn("moveButtonFor", "focusMove"), /#dictionary-list button\.model-move/);
  });
});

describe("the list's fold", () => {
  it("is a row of its card, read from the rows' own left edge (D265)", () => {
    const fold = rule(css, ".show-all");
    assert.match(fold, /text-align: start/);
    assert.match(fold, /background: none/);
    // The whole row is the target, as it is for every door on the page - the
    // press lights the row, not a word inside it. Never centred, and never a
    // bar of its own: the card's frame is the only frame.
    assert.match(fold, /width: 100%/);
    assert.match(fold, /padding: var\(--row-pad-y\) var\(--row-pad-x\)/);
    assert.doesNotMatch(fold, /text-align: center|border: 1px/);
  });

  it("reads Show all with the count the filter lets through, and Show fewer once unfolded", () => {
    const apply = fn("applyFilterIn", "applyModelFilter");
    // A query standing shows everything it matches, so the fold has nothing
    // to offer while one does (Michał, 2026-09-19).
    assert.match(apply, /showAllState\(\{ total: matching, installedCount: installedMatching, expanded, filtering \}\)/);
    assert.match(apply, /rowVisible\(\{ installed, matches, expanded, filtering \}\)/);
    assert.match(apply, /state\.expanded \? t\("options_show_fewer"\) : t\("options_show_all", state\.count\.toLocaleString\(\)\)/);
    assert.match(apply, /setAttribute\("aria-expanded", String\(state\.expanded\)\)/);
    // "Nothing matched" is about the filter alone, never about the fold - and
    // it quotes what was typed (D263).
    assert.match(apply, /none\.hidden = !filtering \|\| matching > 0/);
    assert.match(apply, /none\.textContent = noMatch\(query\.trim\(\)\)/);
    assert.match(page, /id="dictionaries-show-all" class="show-all" aria-controls="dictionary-catalog"/);
    assert.match(page, /id="models-show-all" class="show-all" aria-controls="models-catalog"/);
  });

  it("walks the focus into the list on unfolding and leaves it on the button on folding", () => {
    const toggle = fn("toggleList", "renderModels");
    assert.match(toggle, /if \(!opening\) return;/);
    assert.match(toggle, /\[data-installed="false"\]:not\(\[hidden\]\) button/);
    assert.match(script, /addEventListener\("click", \(\) => toggleList\("dictionary-catalog"\)\)/);
    assert.match(script, /addEventListener\("click", \(\) => toggleList\("models-catalog"\)\)/);
  });
});
