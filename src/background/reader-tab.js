/**
 * The reader is one tab, not one tab per press - and the button that opens it
 * means "read this page", so it also has to say which page.
 *
 * Both halves are here because they are one gesture. Pressing the toolbar
 * button points the reader at the tab it was pressed on and brings the reader
 * forward; pressing it again on another page points it somewhere else, in the
 * same tab. Pressed on the reader itself there is nothing to point at, and it
 * only comes forward - which is also what happens on a page no content script
 * runs in, except that the reader says so.
 *
 * Where the tab ids live and why is `src/lib/session.js`; the mechanics of
 * raising-or-opening are `single-tab.js`, shared with the saved-phrases page.
 * Nothing about what is being read is written down: the page itself travels as
 * one answer to one question and is never stored.
 */

import { webext } from "../lib/browser.js";
import {
  clearReaderSource,
  readReaderTab,
  writeMarksSource,
  writeReaderSource,
  writeReaderTab,
} from "../lib/session.js";
import { raiseOrOpen } from "./single-tab.js";

const READER_PAGE = "reader/reader.html";

/**
 * Only the calls this module makes, so the test fake has to fake exactly that
 * much and no more - `query`, say, is the popup's business, not this module's.
 *
 * @typedef {object} ReaderTabDeps
 * @property {Pick<WebExtBrowser["tabs"], "create" | "update">} [tabs]
 * @property {WebExtBrowser["windows"]} [windows]
 * @property {WebExtBrowser["storage"]["session"]} [session]
 * @property {string} [url]
 * @property {() => number} [now]
 */

/**
 * @param {ReaderTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export async function openReader(deps = {}) {
  const session = deps.session ?? webext().storage.session;

  await raiseOrOpen({
    tabs: deps.tabs ?? webext().tabs,
    windows: deps.windows ?? webext().windows,
    url: deps.url ?? webext().runtime.getURL(READER_PAGE),
    read: () => readReaderTab(session),
    write: (tabId) => writeReaderTab(tabId, session),
  });
}

/**
 * The toolbar button: point the reader at this tab, then bring it forward.
 *
 * The source is written before the reader is opened, so that a reader already
 * standing there sees the change and asks for the new page, while a reader
 * being opened now finds it waiting. Both paths end in one question from the
 * reader, and the page is grabbed once, when it is asked for - not here, where
 * it would have to survive an event page that Firefox may kill in between.
 *
 * @param {WebExtTab} tab the tab the button was pressed on
 * @param {ReaderTabDeps} [deps]
 * @returns {Promise<void>}
 */
export async function readInReader(tab, deps = {}) {
  const session = deps.session ?? webext().storage.session;
  const now = deps.now ?? Date.now;

  const known = await readReaderTab(session);
  // Pressed on the reader itself: there is no page behind it to read, and
  // pointing the reader at itself would replace an article with the reader.
  if (typeof tab.id === "number" && tab.id !== known) {
    // The timestamp is what makes pressing twice on the same tab reach the
    // reader - an unchanged value is a `storage.onChanged` that never fires.
    await writeReaderSource({ tabId: tab.id, at: now() }, session);
  }

  await openReader(deps);
}

/**
 * The popup's "Reading list": point the reader at nothing, then bring it
 * forward. A reader already standing on an article hears the source change
 * and turns to the list; a reader opened by this press finds no source and
 * shows the list on its own.
 *
 * Deliberately blind to where the press came from - on Android the popup is
 * itself a page in a tab, and "the tab the message came from" would name the
 * popup, which nobody meant to read.
 *
 * @param {ReaderTabDeps} [deps]
 * @returns {Promise<void>}
 */
export async function openLibrary(deps = {}) {
  const session = deps.session ?? webext().storage.session;
  const now = deps.now ?? Date.now;

  await clearReaderSource(now, session);
  await openReader(deps);
}

/**
 * The menus' "Highlights" row on the pages that are not the reader: point the
 * reader at the highlights page, then bring it forward. The same bargain as
 * the reading list's entry - a reader already standing hears the source
 * change and turns its view, a reader opened by this press finds the source
 * waiting - and blind to where the press came from for the same reason.
 *
 * @param {ReaderTabDeps} [deps]
 * @returns {Promise<void>}
 */
export async function openMarks(deps = {}) {
  const session = deps.session ?? webext().storage.session;
  const now = deps.now ?? Date.now;

  await writeMarksSource(now, session);
  await openReader(deps);
}
