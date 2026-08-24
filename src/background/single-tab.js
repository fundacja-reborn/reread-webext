/**
 * One extension page, one tab: pressing the row that leads to a page this
 * extension owns brings the existing tab forward instead of opening a copy.
 *
 * The reader lives this way (`reader-tab.js`) and so does the saved-phrases
 * page (`vocab-tab.js`), each remembered under its own `storage.session` key -
 * `src/lib/session.js` says why session storage and nothing longer-lived.
 *
 * Nothing here needs the `tabs` permission. Selecting a tab and focusing a
 * window are allowed without it, and so is finding out that a tab is gone: the
 * call for an id that no longer exists rejects, and that rejection is the test.
 * Finding a page by asking `tabs.query` for its address is what would need
 * one - and would not even work, `moz-extension://` pages being outside
 * `<all_urls>`.
 */

import { tabsShowing } from "../lib/own-tabs.js";

/**
 * Which tab is the page's one tab, checked against what this extension's
 * pages actually are (D140). The stored id names a tab, but a tab is not that
 * page forever: the reader walks to the settings and to the saved phrases in
 * place (D139/D141), and an id left pointing at the walked-away tab made
 * every raise bring forward the wrong page - the page's own sign-out cannot
 * be the only guard, because a last write before leaving is exactly the kind
 * of thing a browser may drop. With a witness, the stored id counts only
 * while the page still lives in that tab, and the page living in some other
 * tab - opened by hand, walked to, or orphaned by a dropped write - is
 * adopted rather than duplicated. Without one, the id is trusted the way it
 * always was.
 *
 * @param {object} where
 * @param {() => Promise<number | null>} where.read the remembered id
 * @param {string} where.url the page the tab must be showing
 * @param {(() => Promise<unknown>) | undefined} where.ask see `tabsShowing`
 * @returns {Promise<number | null>}
 */
export async function tabOnDuty({ read, url, ask }) {
  const stored = await read();
  const seen = await tabsShowing(url, ask);
  if (seen === null) return stored;
  if (stored !== null && seen.includes(stored)) return stored;
  return seen.length > 0 ? (seen[0] ?? null) : null;
}

/**
 * Bringing a tab back rather than opening another one. Two calls, because they
 * fail for different reasons: a tab that is gone means open a new one, while a
 * window that vanished between the two awaits means nothing at all - the tab is
 * already selected and returning `false` here would open the second copy this
 * module exists to prevent.
 *
 * @param {Pick<WebExtBrowser["tabs"], "update">} tabs
 * @param {WebExtBrowser["windows"]} windows
 * @param {number} id
 * @returns {Promise<boolean>} whether the page is now in front of the reader
 */
async function focusTab(tabs, windows, id) {
  /** @type {WebExtTab} */
  let tab;
  try {
    tab = await tabs.update(id, { active: true });
  } catch {
    return false;
  }

  // Selected in its own window is not the same as looked at: the page can sit
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
 * @param {object} deps
 * @param {Pick<WebExtBrowser["tabs"], "create" | "update">} deps.tabs
 * @param {WebExtBrowser["windows"]} deps.windows
 * @param {string} deps.url
 * @param {() => Promise<number | null>} deps.read which tab it was, last anybody looked
 * @param {(tabId: number | null) => Promise<void>} deps.write
 * @returns {Promise<void>}
 */
export async function raiseOrOpen({ tabs, windows, url, read, write }) {
  const known = await read();
  if (known !== null && (await focusTab(tabs, windows, known))) return;

  const opened = await tabs.create({ url });
  // No id means nothing to come back to, and the id we have is the stale one
  // that just failed. Keeping it would send the next press after a dead tab.
  await write(typeof opened.id === "number" ? opened.id : null);
}
