/**
 * The reader is one tab, not one tab per press.
 *
 * Opening it is the only thing the toolbar button does, and pressing it three
 * times used to answer with three identical readers - the first thing the smoke
 * test said about that button. So the tab is remembered and the next press goes
 * back to it.
 *
 * Where it is remembered is the part worth reading. A tab id means nothing after
 * a restart: ids start over, so one written to `storage.local` would name
 * somebody else's tab the next morning, and the button would jump to it.
 * `storage.session` lasts exactly as long as tab ids do - that is the whole
 * reason it is the home for this, and it also survives the event page dying,
 * which a variable in this module would not.
 *
 * Nothing here needs the `tabs` permission. Selecting a tab and focusing a
 * window are allowed without it, and so is finding out that a tab is gone: the
 * call for an id that no longer exists rejects, and that rejection is the test.
 * `tabs.query` is what would need one - our own `moz-extension://` page is not
 * covered by `<all_urls>`.
 */

import { webext } from "../lib/browser.js";

const READER_PAGE = "reader/reader.html";

/** The one key in `storage.session`, and for now the only thing in there. */
export const READER_TAB_KEY = "readerTabId";

/**
 * @typedef {object} ReaderTabDeps
 * @property {WebExtBrowser["tabs"]} [tabs]
 * @property {WebExtBrowser["windows"]} [windows]
 * @property {WebExtBrowser["storage"]["session"]} [session]
 * @property {string} [url]
 */

/**
 * @param {WebExtBrowser["storage"]["session"]} session
 * @returns {Promise<number | null>}
 */
async function rememberedTab(session) {
  const stored = await session.get(READER_TAB_KEY);
  const id = stored[READER_TAB_KEY];
  return typeof id === "number" ? id : null;
}

/**
 * Bringing a tab back rather than opening another one. Two calls, because they
 * fail for different reasons: a tab that is gone means open a new one, while a
 * window that vanished between the two awaits means nothing at all - the tab is
 * already selected and returning `false` here would open the second reader this
 * module exists to prevent.
 *
 * @param {WebExtBrowser["tabs"]} tabs
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
      // The window closed while we were selecting a tab in it. Nothing to do
      // and nothing lost - the next press will find the tab gone as well.
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

  const known = await rememberedTab(session);
  if (known !== null && (await focusTab(tabs, windows, known))) return;

  const opened = await tabs.create({ url });
  if (typeof opened.id === "number") {
    await session.set({ [READER_TAB_KEY]: opened.id });
  } else {
    // No id means nothing to come back to, and the id we have is the stale one
    // that just failed. Keeping it would send the next press after a dead tab.
    await session.remove(READER_TAB_KEY);
  }
}
