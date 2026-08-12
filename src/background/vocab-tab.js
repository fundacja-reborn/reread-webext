/**
 * The saved-phrases page as one tab, not one tab per press.
 *
 * Unlike the reader there is nothing to point this page at: it shows the
 * vocabulary of the configured pair, and the pair travels through the
 * settings, never through this press. So the whole job is the shared half -
 * raise the remembered tab or open one (`single-tab.js`), under its own
 * `storage.session` key (`src/lib/session.js`).
 */

import { webext } from "../lib/browser.js";
import { readVocabTab, writeVocabTab } from "../lib/session.js";
import { raiseOrOpen } from "./single-tab.js";

const VOCAB_PAGE = "vocab/vocab.html";

/**
 * Only the calls this module makes, so the test fake has to fake exactly that
 * much and no more.
 *
 * @typedef {object} VocabTabDeps
 * @property {Pick<WebExtBrowser["tabs"], "create" | "update">} [tabs]
 * @property {WebExtBrowser["windows"]} [windows]
 * @property {WebExtBrowser["storage"]["session"]} [session]
 * @property {string} [url]
 */

/**
 * @param {VocabTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export async function openVocabulary(deps = {}) {
  const session = deps.session ?? webext().storage.session;

  await raiseOrOpen({
    tabs: deps.tabs ?? webext().tabs,
    windows: deps.windows ?? webext().windows,
    url: deps.url ?? webext().runtime.getURL(VOCAB_PAGE),
    read: () => readVocabTab(session),
    write: (tabId) => writeVocabTab(tabId, session),
  });
}
