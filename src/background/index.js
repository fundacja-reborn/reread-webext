/**
 * The background context: the only place that translates, and later the only
 * place that touches the vocabulary database.
 *
 * Content scripts ask, the background answers. That split is not ceremony - it
 * is what makes the store shared across sites (extension storage is per
 * extension, not per origin) and what keeps the engine, once it is a few
 * megabytes of WebAssembly, loaded once instead of once per tab.
 */

import { commandsApi, offscreenApi, webext } from "../lib/browser.js";
import { chosenPair, publishPlatform, readConfig } from "../lib/config.js";
import { writeInventory } from "../lib/models/inventory.js";
import { listModels } from "../lib/models/store.js";
import { ErrorCode, Message, asRequest, fail, ok } from "../lib/protocol.js";
import { ensurePersistent } from "../lib/storage-report.js";
import { toolbarIconFor } from "../lib/theme-icon.js";
import { setProvider, translate } from "../lib/translator/index.js";
import { asSchemeReport } from "../lib/translator/providers/bergamot/host-protocol.js";
import { bergamot } from "../lib/translator/providers/bergamot/index.js";
import { bergamotViaHost, raiseEngineHost } from "../lib/translator/providers/bergamot/remote.js";
import { lookUp } from "../lib/dict/lookup.js";
import { readPage } from "./page.js";
import { openLibrary, openMarks, openReader, readInReader } from "./reader-tab.js";
import { openSettings, openVocabulary } from "./room-tab.js";
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
 *   | import("../lib/protocol.js").DictEntry[]
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
      // No pair chosen means no model to answer with - the same fact, the
      // same sentence and the same way out (the settings page) as a pair
      // whose model is not installed, so the code is reused rather than
      // minted: the bubble already knows how to show it.
      const pair = chosenPair(config);
      if (pair === null) return fail(ErrorCode.MODEL_MISSING);
      // Side by side, not one after the other: the dictionary read is a point
      // lookup and the translation is the engine, so waiting for them together
      // costs what the engine costs and nothing more.
      const [translated, entries] = await Promise.all([
        translate({
          text: request.text,
          context: request.context,
          from: pair.from,
          to: pair.to,
        }),
        lookUp(request.text, pair.from),
      ]);

      // Dictionary entries ride with a translation and never instead of one: a
      // failed translation is an error the bubble has to show, and hanging
      // definitions off it would make an error message into a half-answer.
      return translated.ok ? ok({ ...translated.value, entries }) : translated;
    }
    case Message.LOOK_UP: {
      // The quiet vocabulary's hand on somebody else's page (D162): the
      // dictionaries live in the extension's own storage, out of a content
      // script's reach, so the page asks here - the reader page keeps
      // reading its own database directly (D121). No pair chosen means no
      // language to ask in: an honest empty list rather than an error,
      // because the bubble this feeds stands on its own two buttons anyway.
      const pair = chosenPair(await readConfig());
      return ok(pair === null ? [] : await lookUp(request.text, pair.from));
    }
    case Message.OPEN_READER: {
      // Two senders, one function. The popup says which tab it stood over,
      // because it knows and the message can carry it; the launcher bubble in
      // a page sends no id at all, because a content script does not know its
      // own tab - the sender does, and that is the same answer by other means.
      // Without either - the popup over a tab that had no id - the reader only
      // comes forward.
      const sourceTabId = request.sourceTabId ?? sender.tab?.id;
      if (typeof sourceTabId === "number") await readInReader({ id: sourceTabId }, { from: sender.tab?.id });
      else await openReader({ from: sender.tab?.id });
      return ok(null);
    }
    // The sender's tab travels with every door below as `from` - not as the
    // page to read, only as the first tab worth turning to the page asked
    // for when none shows it (D147): a menu row pressed in a page of ours
    // turns that page's tab, the way the reader's rows have walked in place
    // since D139. A tab that is not one of our rooms - a web page under the
    // launcher, the popup's own tab on Android - is never turned.
    case Message.OPEN_LIBRARY: {
      // No sender fallback into the *source* on purpose: the reading list is
      // not about any tab, and on Android the popup's own tab is the one the
      // fallback would name.
      await openLibrary({ from: sender.tab?.id });
      return ok(null);
    }
    case Message.OPEN_MARKS: {
      // The reader's own view by another door: not about any tab either.
      await openMarks({ from: sender.tab?.id });
      return ok(null);
    }
    case Message.OPEN_VOCABULARY: {
      await openVocabulary({ from: sender.tab?.id });
      return ok(null);
    }
    case Message.OPEN_SETTINGS: {
      // Since D147 the settings are a room like the other two, not the
      // browser's `openOptionsPage`: that call raises an open settings tab
      // but cannot turn a tab of ours to it, and the reader's walk to the
      // settings in place (D139) left a settings tab behind every time the
      // reader was next raised elsewhere.
      await openSettings({ from: sender.tab?.id });
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
// over, and the only way to learn it without the `tabs` permission. Guarded
// through `commandsApi()` because Android has no `commands` API, and an
// unguarded access here would not just skip the shortcut - it would throw and
// take every registration below this line with it (`onInstalled` included).
commandsApi()?.onCommand.addListener((command, tab) => {
  if (command !== Message.OPEN_READER) return;
  void (tab === undefined ? openReader() : readInReader(tab));
});

// The copy pages read is written whenever the vocabulary changes. An install or
// an update is the one moment it can be missing while the database is not, so
// it is also written here - once, not on every wake. The platform rides along
// for the same reason: content scripts cannot ask which OS this is, and the
// answer never changes for a device, so once is exactly enough. The model
// inventory too: the settings page keeps it fresh from here on, and this one
// write is what hands the key to installations that predate it - and to a
// fresh install, whose first page needs "no models yet" said in storage
// before the settings page has ever been opened.
webext().runtime.onInstalled.addListener(() => {
  void refreshVocabulary();
  void publishPlatform().catch(() => {
    // Storage unreachable: pages fall back to the desktop default, and the
    // next update gets another chance.
  });
  void listModels()
    .then(writeInventory)
    .catch(() => {
      // No inventory written reads as "nobody has said anything", and the
      // launcher stays quiet about models - the safe direction.
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

// The one thing asked of the browser about the extension's own storage: to
// keep it. Firefox grants it to every extension declaring `unlimitedStorage`,
// Chromium needs no promise, and WebKit's answer is a diagnosis as much as a
// grant - the settings page shows it (`lib/storage-report.js`). Asked on every
// wake rather than once at install: an origin already persisted costs one
// question, and on WebKit the answer can change with what the user did since.
void ensurePersistent();
