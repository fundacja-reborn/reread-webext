/**
 * The background context: the only place that translates, and later the only
 * place that touches the vocabulary database.
 *
 * Content scripts ask, the background answers. That split is not ceremony - it
 * is what makes the store shared across sites (extension storage is per
 * extension, not per origin) and what keeps the engine, once it is a few
 * megabytes of WebAssembly, loaded once instead of once per tab.
 */

import { offscreenApi, webext } from "../lib/browser.js";
import { publishPlatform, readConfig } from "../lib/config.js";
import { ErrorCode, Message, asRequest, fail, ok } from "../lib/protocol.js";
import { toolbarIconFor } from "../lib/theme-icon.js";
import { setProvider, translate } from "../lib/translator/index.js";
import { asSchemeReport } from "../lib/translator/providers/bergamot/host-protocol.js";
import { bergamot } from "../lib/translator/providers/bergamot/index.js";
import { bergamotViaHost, raiseEngineHost } from "../lib/translator/providers/bergamot/remote.js";
import { lookUp } from "./dictionary.js";
import { readPage } from "./page.js";
import { openLibrary, openMarks, openReader, readInReader } from "./reader-tab.js";
import { openVocabulary } from "./vocab-tab.js";
import {
  forgetPhrase,
  importPhrases,
  listVocabulary,
  refreshVocabulary,
  savePhrase,
} from "./vocabulary.js";

// The engine itself starts on the first translation, not here: this module runs
// every time the background wakes, and waking up must stay cheap. Which shape
// of the provider answers is the one real browser difference in this file: an
// event page runs the engine's worker itself, a service worker cannot spawn
// workers and delegates to the offscreen document instead - and "is there an
// offscreen API" is the whole test.
setProvider(offscreenApi() === null ? bergamot : bergamotViaHost);

/**
 * @typedef {null
 *   | import("../lib/protocol.js").Translation
 *   | import("../lib/protocol.js").VocabEntry[]
 *   | import("../lib/protocol.js").ImportReport
 *   | import("../lib/protocol.js").Page} Answer
 */

/**
 * @param {import("../lib/protocol.js").Request} request
 * @param {WebExtMessageSender} sender
 * @returns {Promise<import("../lib/protocol.js").Result<Answer>>}
 */
async function handle(request, sender) {
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
      // Two senders, one function. The popup says which tab it stood over,
      // because it knows and the message can carry it; the launcher bubble in
      // a page sends no id at all, because a content script does not know its
      // own tab - the sender does, and that is the same answer by other means.
      // Without either - the popup over a tab that had no id - the reader only
      // comes forward.
      const sourceTabId = request.sourceTabId ?? sender.tab?.id;
      if (typeof sourceTabId === "number") await readInReader({ id: sourceTabId });
      else await openReader();
      return ok(null);
    }
    case Message.OPEN_LIBRARY: {
      // No sender fallback on purpose: the reading list is not about any tab,
      // and on Android the popup's own tab is the one the fallback would name.
      await openLibrary();
      return ok(null);
    }
    case Message.OPEN_MARKS: {
      // The reader's own view by another door: not about any tab either.
      await openMarks();
      return ok(null);
    }
    case Message.OPEN_VOCABULARY: {
      await openVocabulary();
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
    case Message.IMPORT_PHRASES:
      return await importPhrases(request);
  }
}

webext().runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The engine host saying which color scheme the browser is in - the one
  // message on this channel that is not a request and gets no response. It
  // must be picked off before `asRequest`, whose answer to everything it does
  // not know is `unknown_message`. Firefox never sends it (its event page
  // never raises a host) and would ignore it here the same way.
  const scheme = asSchemeReport(message);
  if (scheme !== null) {
    void webext().action.setIcon({ path: toolbarIconFor(scheme.dark) }).catch(() => {});
    return false;
  }

  const request = asRequest(message);
  if (request === null) {
    sendResponse(fail(ErrorCode.UNKNOWN_MESSAGE));
    return false;
  }

  // `sendResponse` plus `return true` rather than returning the promise:
  // Firefox understands both, Chromium only this one, and the difference is
  // not worth a compatibility branch.
  handle(request, sender).then(sendResponse, () => sendResponse(fail(ErrorCode.INTERNAL)));
  return true;
});

// The toolbar button opens the popup now, so `action.onClicked` never fires;
// the keyboard shortcut is what still reaches the reader in one gesture. The
// command is named after the message because it is the same request by other
// means, and it brings its tab along - the same tab `onClicked` used to hand
// over, and the only way to learn it without the `tabs` permission.
webext().commands.onCommand.addListener((command, tab) => {
  if (command !== Message.OPEN_READER) return;
  void (tab === undefined ? openReader() : readInReader(tab));
});

// The copy pages read is written whenever the vocabulary changes. An install or
// an update is the one moment it can be missing while the database is not, so
// it is also written here - once, not on every wake. The platform rides along
// for the same reason: content scripts cannot ask which OS this is, and the
// answer never changes for a device, so once is exactly enough.
webext().runtime.onInstalled.addListener(() => {
  void refreshVocabulary();
  void publishPlatform().catch(() => {
    // Storage unreachable: pages fall back to the desktop default, and the
    // next update gets another chance.
  });
});

// Chromium only: at browser launch the toolbar icon is the manifest default -
// the light-toolbar mark - because `setIcon` state does not survive a restart
// and Chrome has no theme-aware manifest icons. Raising the engine host makes
// it report the color scheme (see the handler above), which is the whole
// correction; the host then closes itself. Firefox swaps icons natively from
// `action.theme_icons` and skips all of this.
webext().runtime.onStartup.addListener(() => {
  if (offscreenApi() !== null) void raiseEngineHost();
});
