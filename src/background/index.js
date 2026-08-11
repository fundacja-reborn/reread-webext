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
import { lookUp } from "./dictionary.js";
import { readPage } from "./page.js";
import { openReader, readInReader } from "./reader-tab.js";
import { forgetPhrase, listVocabulary, refreshVocabulary, savePhrase } from "./vocabulary.js";

// The engine itself starts on the first translation, not here: this module runs
// every time Firefox wakes the event page, and waking up must stay cheap.
setProvider(bergamot);

/**
 * @typedef {null
 *   | import("../lib/protocol.js").Translation
 *   | import("../lib/protocol.js").VocabEntry[]
 *   | import("../lib/protocol.js").Page} Answer
 */

/**
 * @param {import("../lib/protocol.js").Request} request
 * @returns {Promise<import("../lib/protocol.js").Result<Answer>>}
 */
async function handle(request) {
  switch (request.kind) {
    case Message.TRANSLATE: {
      const config = await readConfig();
      // Side by side, not one after the other: the dictionary read is a point
      // lookup and the translation is the engine, so waiting for them together
      // costs what the engine costs and nothing more.
      const [translated, entries] = await Promise.all([
        translate({
          text: request.text,
          context: request.context,
          from: config.sourceLang,
          to: config.targetLang,
        }),
        lookUp(request.text, config.sourceLang),
      ]);

      // Dictionary entries ride with a translation and never instead of one: a
      // failed translation is an error the bubble has to show, and hanging
      // definitions off it would make an error message into a half-answer.
      return translated.ok ? ok({ ...translated.value, entries }) : translated;
    }
    case Message.OPEN_READER: {
      await openReader();
      return ok(null);
    }
    case Message.OPEN_SETTINGS: {
      await webext().runtime.openOptionsPage();
      return ok(null);
    }
    case Message.READ_PAGE:
      return await readPage();
    case Message.SAVE_PHRASE:
      return await savePhrase(request);
    case Message.FORGET_PHRASE:
      return await forgetPhrase(request);
    case Message.LIST_PHRASES:
      return await listVocabulary();
  }
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

// The button says "read this page", so it needs the page: `onClicked` hands
// over the tab it was pressed on, and that is the only way the background finds
// out which one it was without the `tabs` permission.
webext().action.onClicked.addListener((tab) => {
  void readInReader(tab);
});

// The copy pages read is written whenever the vocabulary changes. An install or
// an update is the one moment it can be missing while the database is not, so
// it is also written here - once, not on every wake.
webext().runtime.onInstalled.addListener(() => {
  void refreshVocabulary();
});
