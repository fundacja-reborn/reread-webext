/**
 * The background context: the only place that translates, and later the only
 * place that touches the vocabulary database.
 *
 * Content scripts ask, the background answers. That split is not ceremony - it
 * is what makes the store shared across sites (extension storage is per
 * extension, not per origin) and what keeps the engine, once it is a few
 * megabytes of WebAssembly, loaded once instead of once per tab.
 */

import { webext } from "../lib/browser.js";
import { readConfig } from "../lib/config.js";
import { ErrorCode, Message, asRequest, fail, ok } from "../lib/protocol.js";
import { setProvider, translate } from "../lib/translator/index.js";
import { bergamot } from "../lib/translator/providers/bergamot/index.js";
import { forgetPhrase, listVocabulary, refreshVocabulary, savePhrase } from "./vocabulary.js";

const READER_PAGE = "reader/reader.html";

// The engine itself starts on the first translation, not here: this module runs
// every time Firefox wakes the event page, and waking up must stay cheap.
setProvider(bergamot);

/**
 * @typedef {string | null | import("../lib/protocol.js").VocabEntry[]} Answer
 */

/**
 * @param {import("../lib/protocol.js").Request} request
 * @returns {Promise<import("../lib/protocol.js").Result<Answer>>}
 */
async function handle(request) {
  switch (request.kind) {
    case Message.TRANSLATE: {
      const config = await readConfig();
      return translate({
        text: request.text,
        from: config.sourceLang,
        to: config.targetLang,
      });
    }
    case Message.OPEN_READER: {
      await openReader();
      return ok(null);
    }
    case Message.OPEN_SETTINGS: {
      await webext().runtime.openOptionsPage();
      return ok(null);
    }
    case Message.SAVE_PHRASE:
      return await savePhrase(request);
    case Message.FORGET_PHRASE:
      return await forgetPhrase(request);
    case Message.LIST_PHRASES:
      return await listVocabulary();
  }
}

async function openReader() {
  await webext().tabs.create({ url: webext().runtime.getURL(READER_PAGE) });
}

webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = asRequest(message);
  if (request === null) {
    sendResponse(fail(ErrorCode.UNKNOWN_MESSAGE));
    return false;
  }

  // `sendResponse` plus `return true` rather than returning the promise:
  // Firefox understands both, Chromium only this one, and the difference is
  // not worth a compatibility branch.
  handle(request).then(sendResponse, () => sendResponse(fail(ErrorCode.INTERNAL)));
  return true;
});

webext().action.onClicked.addListener(() => {
  void openReader();
});

// The copy pages read is written whenever the vocabulary changes. An install or
// an update is the one moment it can be missing while the database is not, so
// it is also written here - once, not on every wake.
webext().runtime.onInstalled.addListener(() => {
  void refreshVocabulary();
});
