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
 * Where the tab ids live and why is `src/lib/session.js`. Nothing about what is
 * being read is written down: the page itself travels as one answer to one
 * question and is never stored.
 *
 * Nothing here needs the `tabs` permission. Selecting a tab and focusing a
 * window are allowed without it, and so is finding out that a tab is gone: the
 * call for an id that no longer exists rejects, and that rejection is the test.
 * Finding the reader by asking `tabs.query` for its address is what would need
 * one - and would not even work, `moz-extension://` pages being outside
 * `<all_urls>`.
 */

import { webext } from "../lib/browser.js";
import { readReaderTab, writeReaderSource, writeReaderTab } from "../lib/session.js";

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
 * Bringing a tab back rather than opening another one. Two calls, because they
 * fail for different reasons: a tab that is gone means open a new one, while a
 * window that vanished between the two awaits means nothing at all - the tab is
 * already selected and returning `false` here would open the second reader this
 * module exists to prevent.
 *
 * @param {Pick<WebExtBrowser["tabs"], "update">} tabs
 * @param {WebExtBrowser["windows"]} windows
 * @param {number} id
 * @returns {Promise<boolean>} whether the reader is now in front of the reader
 */
async function focusTab(tabs, windows, id) {
  /** @type {WebExtTab} */
  let tab;
  try {
    tab = await tabs.update(id, { active: true });
  } catch {
    return false;
  }

  // Selected in its own window is not the same as looked at: the reader can sit
  // in a window behind this one, and stopping here would look like the button
  // did nothing.
  if (typeof tab.windowId === "number") {
    try {
      await windows.update(tab.windowId, { focused: true });
    } catch {
      // The window closed while we were selecting a tab in it - or this is
      // Android, which has no `windows` API at all. Nothing to do either way:
      // on a phone the selected tab is the visible one already.
    }
  }
  return true;
}

/**
 * @param {ReaderTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export async function openReader(deps = {}) {
  const tabs = deps.tabs ?? webext().tabs;
  const windows = deps.windows ?? webext().windows;
  const session = deps.session ?? webext().storage.session;
  const url = deps.url ?? webext().runtime.getURL(READER_PAGE);

  const known = await readReaderTab(session);
  if (known !== null && (await focusTab(tabs, windows, known))) return;

  const opened = await tabs.create({ url });
  // No id means nothing to come back to, and the id we have is the stale one
  // that just failed. Keeping it would send the next press after a dead tab.
  await writeReaderTab(typeof opened.id === "number" ? opened.id : null, session);
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
