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
      // The document as a whole: its pictures, and the files it is written out as.
      "nav-pictures",
      "nav-export-epub",
      "nav-export-markdown",
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
