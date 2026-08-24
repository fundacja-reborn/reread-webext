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
import { raiseOrOpen, tabOnDuty } from "./single-tab.js";

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
 * @property {() => Promise<unknown>} [contexts] the extension's own open
 *   contexts, `runtime.getContexts` shaped - injected by the tests
 */

/**
 * @param {VocabTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export async function openVocabulary(deps = {}) {
  const session = deps.session ?? webext().storage.session;
  const url = deps.url ?? webext().runtime.getURL(VOCAB_PAGE);

  await raiseOrOpen({
    tabs: deps.tabs ?? webext().tabs,
    windows: deps.windows ?? webext().windows,
    url,
    // The witness, exactly the reader's (D140/D141, `single-tab.js`): since
    // the reader's menu walks to this page in place, a phrases tab can both
    // stop being one (it walked on) and start somewhere nobody remembered -
    // the walked-to page is adopted, so a popup press raises it rather than
    // opening a copy beside it.
    read: () => tabOnDuty({ read: () => readVocabTab(session), url, ask: deps.contexts }),
    write: (tabId) => writeVocabTab(tabId, session),
  });
}
