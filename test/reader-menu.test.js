import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The reader's menu (the drawn ☰ over an article, a book, the list and the
 * highlights): the order of its rows is a rule, not a list of accidents
 * (D117, D235). From the nearest to the farthest: what acts inside the open
 * text, what acts on the document as a whole, the window, the doors to the
 * extension's other rooms, the one door out of it, and the settings last.
 * The rows that came after D117 had been slotted by their decision's date,
 * and the two doors ended up in the middle of the list (Michał, 2026-09-17).
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The ids of the menu's rows in markup order - every `a` and `button`
 * standing directly in the menu.
 *
 * @param {string} markup
 * @returns {string[]}
 */
function menuRows(markup) {
  const from = markup.indexOf('id="menu-panel"');
  const menu = markup.slice(from, markup.indexOf("</nav>", from));
  return Array.from(menu.matchAll(/<(?:a|button) id="([^"]+)"/gu), (match) => match[1] ?? "");
}

describe("the reader's menu", () => {
  it("runs from the nearest to the farthest: the text, the document, the window, the doors, the settings", async () => {
    const markup = await source("reader/reader.html");
    assert.deepEqual(menuRows(markup), [
      // Inside the open text.
      "nav-toc",
      "nav-search",
      "nav-marks",
      // The document as a whole: its read mark, its pictures, the files it
      // is written out as - and last the act that cannot be taken back (D272).
      "nav-mark-read",
      "nav-pictures",
      "nav-export-epub",
      "nav-export-markdown",
      "nav-delete",
      // The window.
      "nav-fullscreen",
      // The doors: the extension's own rooms, then the one out of it.
      "nav-vocabulary",
      "nav-library",
      "original",
      // The door every menu keeps at the bottom.
      "nav-settings",
    ]);
  });
});

// The acts on the document in the menu (D272). Since D270 a long book wears
// its action rows only at its beginning and under its last line, so marking
// it read or deleting it from the middle of it cost a trip to either end -
// and an article's rows are a long scroll from its middle too. The menu is
// one place to learn for both. What the page does with the two rows is read
// from the sources, since the page only exists in a browser.
describe("the document's acts in the reader's menu", () => {
  /**
   * One function of the reader's script, from its name to the next one's.
   *
   * @param {string} script
   * @param {string} name
   * @param {string} next
   */
  function fn(script, name, next) {
    const from = script.indexOf(`function ${name}(`);
    const to = script.indexOf(`function ${next}(`, from);
    assert.ok(from >= 0 && to > from, `${name} before ${next}`);
    return script.slice(from, to);
  }

  it("are dressed with the rows they repeat, over every document the list holds", async () => {
    const acts = fn(await source("reader/reader.js"), "refreshActions", "refreshExportRows");
    // Whether the list holds the document decides, and nothing else does:
    // not the place in a book, which hides the rows around the text (D270).
    assert.match(acts, /navMarkRead\.hidden = row === null;/);
    assert.match(acts, /navDelete\.hidden = row === null;/);
    assert.doesNotMatch(acts, /navMarkRead\.hidden = [^;]*frame/);
    // One label and one state for the three read marks.
    assert.match(acts, /navMarkReadLabel\.textContent = label;/);
    assert.match(acts, /navMarkRead\.setAttribute\("aria-pressed", String\(read\)\);/);
    // A redraw never leaves the row asking.
    assert.match(acts, /navDelete\.removeAttribute\("data-armed"\);/);
    // With no document on screen there is nothing to act on.
    const nothing = acts.indexOf("if (target === null) {");
    const none = acts.slice(nothing, acts.indexOf("return;", nothing));
    assert.match(none, /navMarkRead\.hidden = true/);
    assert.match(none, /navDelete\.hidden = true/);
  });

  it("leave the menu with the document", async () => {
    const script = await source("reader/reader.js");
    const from = script.indexOf("if (navExportMarkdown !== null) navExportMarkdown.hidden = true;\n  // And so are the document's two acts");
    assert.ok(from >= 0, "the view's teardown hides the two rows");
    const teardown = script.slice(from, script.indexOf("showSegmentNav(null);", from));
    assert.match(teardown, /navMarkRead\.hidden = true/);
    assert.match(teardown, /navDelete\.hidden = true/);
  });

  it("are the buttons' own handlers, and neither press puts the menu away", async () => {
    const script = await source("reader/reader.js");
    assert.match(script, /navMarkRead\?\.addEventListener\("click", \(\) => void onMarkReadPress\(\)\);/);
    assert.match(script, /navDelete\?\.addEventListener\("click", \(\) => void onRemovePress\(navDelete\)\);/);
    // Delete's second press has to land on the row the first one turned
    // into the question - a menu closed in between would take the row away.
    for (const row of ["navMarkRead", "navDelete"]) {
      const at = script.indexOf(`${row}?.addEventListener("click"`);
      const handler = script.slice(at, script.indexOf("\n", at));
      assert.doesNotMatch(handler, /setPanel|closePanels/, `${row}'s press closes the menu`);
    }
  });

  it("ask before deleting the way every Delete here does, and close the menu only on the confirmed press", async () => {
    const script = await source("reader/reader.js");
    const press = fn(script, "onRemovePress", "countFinished");
    const armed = press.indexOf('if (!button.hasAttribute("data-armed")) {');
    const confirmed = press.indexOf("if (button === navDelete) closePanels();");
    assert.ok(armed >= 0 && confirmed > armed, "the menu closes after the question, not before it");
    assert.ok(press.indexOf("armDelete(button);") < confirmed);
    // A row as wide as the menu holds no width while it asks.
    assert.match(press, /if \(button !== navDelete\) button\.style\.minWidth/);
    // It stands down to its own words, which are its accessible name.
    const down = fn(script, "disarmDelete", "armDelete");
    assert.match(down, /if \(armed === navDelete\) \{\n\s+armed\.textContent = t\("reader_menu_delete"\);\n\s+armed\.removeAttribute\("aria-label"\);/);
    // And the title the question names is the document's.
    assert.match(fn(script, "deleteTitle", "armedDelete"), /button === navDelete\) \{\n\s+return titleElement\?\.textContent \?\? "";/);
  });

  it("say the read mark's state with a drawn check, and the question with weight", async () => {
    const markup = await source("reader/reader.html");
    const row = markup.slice(markup.indexOf('<button id="nav-mark-read"'), markup.indexOf("</button>", markup.indexOf('<button id="nav-mark-read"')));
    assert.match(row, /aria-pressed="false" hidden>/);
    assert.match(row, /<svg class="reader-icon nav-check"[^>]*aria-hidden="true"/);
    assert.match(row, /<span id="nav-mark-read-label">Mark as read<\/span>/);
    // The words are set by script (a book's name the book), so the span is
    // not marked for the page's own localization.
    assert.doesNotMatch(row, /data-i18n/);
    const css = await source("reader/reader.css");
    assert.match(css, /#nav-mark-read\[aria-pressed="false"\] \.nav-check \{\n  display: none;\n\}/);
    assert.match(css, /\.nav-menu #nav-delete\[data-armed\],\n\.nav-menu #nav-delete\[data-armed\]:hover \{\n  border-color: var\(--page-accent\);\n  background: none;/);
  });
});
