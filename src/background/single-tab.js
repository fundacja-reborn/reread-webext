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
