/**
 * Which tabs one of this extension's own pages lives in, by the browser's
 * account (`runtime.getContexts`) - the one permissionless answer to "what
 * does that tab actually show": tab ids cannot say, and extension pages sit
 * outside `<all_urls>`, so neither `tabs.update`'s result nor `tabs.query`
 * could (D140).
 *
 * Two askers, one home: the background's single-tab raising verifies and
 * adopts with it (`background/single-tab.js`), and the pages that are not
 * the reader use it to offer a way back to the reading (`back-arrow.js`,
 * D142).
 */

import { webext } from "./browser.js";

/**
 * The tabs the page at `url` really lives in right now - or null where
 * nobody can say: an engine without the API (Firefox before 126), a call
 * that failed, an answer of the wrong shape. Null means "no witness", never
 * "no such tabs".
 *
 * @param {string} url the page, as `runtime.getURL` names it
 * @param {(() => Promise<unknown>) | undefined} ask the tests' fake; the
 *   live `runtime.getContexts` otherwise
 * @returns {Promise<number[] | null>}
 */
export async function tabsShowing(url, ask) {
  try {
    const query = ask ?? (() => webext().runtime.getContexts?.({ contextTypes: ["TAB"] }));
    const views = await query();
    if (!Array.isArray(views)) return null;
    const tabs = [];
    for (const view of views) {
      if (typeof view !== "object" || view === null) continue;
      const { documentUrl, tabId } = /** @type {Record<string, unknown>} */ (view);
      if (typeof documentUrl !== "string" || !documentUrl.startsWith(url)) continue;
      if (typeof tabId === "number" && tabId >= 0) tabs.push(tabId);
    }
    return tabs;
  } catch {
    return null;
  }
}
