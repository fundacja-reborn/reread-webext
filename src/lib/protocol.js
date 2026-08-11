/**
 * What content scripts and extension pages may ask the background for, and what
 * they get back.
 *
 * Two rules hold everywhere downstream of this file:
 *
 * 1. Nothing that crosses this boundary throws. A failure is a value with a
 *    code from `ErrorCode`, because the receiving side has to render it, and
 *    "render an exception" has no good answer.
 * 2. A new error code is a UI change, not an implementation detail: something
 *    has to be able to say it in a sentence a reader understands.
 */

/**
 * Message kinds. The `kind` field is the discriminator on every request.
 *
 * All of them travel page to background, except the last one: `grab-page` is
 * the only message that goes the other way, and it exists because the toolbar
 * button is heard by the background while the page it is about is somewhere
 * else. `asRequest` narrows the first group, `asPageRequest` the second - one
 * list of kinds, two directions, and neither validator accepts the other's.
 */
export const Message = Object.freeze({
  TRANSLATE: "translate",
  OPEN_READER: "open-reader",
  OPEN_SETTINGS: "open-settings",
  SAVE_PHRASE: "save-phrase",
  FORGET_PHRASE: "forget-phrase",
  LIST_PHRASES: "list-phrases",
  READ_PAGE: "read-page",
  GRAB_PAGE: "grab-page",
});

/** Every way a request can fail, and the whole list of them. */
export const ErrorCode = Object.freeze({
  /** No translation engine is bundled yet (the state before M1 lands). */
  ENGINE_MISSING: "engine_missing",
  /** The engine is there, the model for this language pair is not. */
  MODEL_MISSING: "model_missing",
  /** No model exists for this pair at all. */
  UNSUPPORTED_PAIR: "unsupported_pair",
  /** Longer than the tooltip is meant for - a page, not a phrase. */
  TOO_LONG: "too_long",
  /**
   * There is nothing for the reader to take: the tab it was pointed at is gone,
   * or it is a page no content script runs in - `about:`, the PDF viewer, the
   * add-ons site. Not an error in the sense of something being broken.
   */
  NO_PAGE: "no_page",
  /** A request the background does not know. Reaching a user means a bug. */
  UNKNOWN_MESSAGE: "unknown_message",
  /** Anything that got as far as an exception. */
  INTERNAL: "internal",
});

/** @typedef {(typeof ErrorCode)[keyof typeof ErrorCode]} ErrorCodeValue */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, code: ErrorCodeValue }} Result
 */

/**
 * One saved phrase, as small as it can be sent: its key and what it means.
 * `[normalized, translations]`. No id and no display form - a page knows the
 * text it is looking at, and ids are the database's business.
 *
 * @typedef {[string, string[]]} VocabEntry
 */

/**
 * One dictionary's answer about a word: which book, how that book spells the
 * word it found, and what it says. The headword is worth carrying because it is
 * not always what was selected - a dictionary asked about `watches` answers
 * about `watch`, and a reader should be able to see that is what happened.
 *
 * @typedef {{ dictionary: string, headword: string, senses: string[] }} DictEntry
 */

/**
 * What comes back from a translation: the phrase, the sentence it was in when
 * there was one worth showing, and whatever the installed dictionaries have to
 * say about it.
 *
 * The gloss is what the bubble shows and what gets saved - always the phrase
 * translated as a phrase, never a piece cut out of the sentence, because this
 * engine cannot say which piece that would be. The sentence and the dictionary
 * entries are the second layer, shown only when asked for, and neither is ever
 * stored.
 *
 * `entries` is optional here and always present on the wire: a provider
 * produces a translation and knows nothing about dictionaries, the background
 * fills them in, and `asTranslation` gives the receiving side an array either
 * way. That is what keeps "is there a second layer" one question rather than
 * three states.
 *
 * @typedef {{ gloss: string, sentence: string | null, entries?: DictEntry[] }} Translation
 */

/**
 * A translate request carries the text, and the sentence around it when the
 * page had one: the language pair lives in the settings, the settings live in
 * the background, and a content script that never has to look them up is a
 * content script that cannot disagree with the background about which pair is
 * configured. The same is true of every request below - phrases are addressed
 * by their text, and the background is the only side that normalizes it.
 *
 * `context` is the sentence, not a promise about it: the background may ignore
 * it, and nothing about the answer's shape depends on whether it was sent. It
 * exists on the wire and nowhere else - no request stores it, which is what O2
 * decided about context in the database and this does not reopen.
 *
 * Saving replaces the meanings of a phrase with the ones given, which is what
 * makes "the phrase means exactly what the bubble is showing" one rule instead
 * of two messages.
 *
 * @typedef {{ kind: typeof Message.TRANSLATE, text: string, context?: string }} TranslateRequest
 * @typedef {{ kind: typeof Message.OPEN_READER }} OpenReaderRequest
 * @typedef {{ kind: typeof Message.OPEN_SETTINGS }} OpenSettingsRequest
 * @typedef {{ kind: typeof Message.SAVE_PHRASE, text: string, translations: string[] }} SavePhraseRequest
 * @typedef {{ kind: typeof Message.FORGET_PHRASE, text: string }} ForgetPhraseRequest
 * @typedef {{ kind: typeof Message.LIST_PHRASES }} ListPhrasesRequest
 * @typedef {{ kind: typeof Message.READ_PAGE }} ReadPageRequest
 * @typedef {TranslateRequest
 *   | OpenReaderRequest
 *   | OpenSettingsRequest
 *   | SavePhraseRequest
 *   | ForgetPhraseRequest
 *   | ListPhrasesRequest
 *   | ReadPageRequest} Request
 */

/**
 * A page as the reader gets it: the address, the title the tab had, and the
 * document serialized as it stands - after scripts have run, which is the whole
 * reason this comes from the page rather than from a second download.
 *
 * It is not stored anywhere at either end. It travels as the answer to one
 * question, lives in the reader tab for as long as that tab shows it, and that
 * is the end of it.
 *
 * @typedef {{ url: string, title: string, html: string }} Page
 * @typedef {{ kind: typeof Message.GRAB_PAGE }} GrabPageRequest
 */

/**
 * How much serialized HTML may cross the message boundary. Generous on purpose:
 * a long article with its markup is a few hundred kilobytes, and the pages that
 * blow past this are applications rather than things to read. Refusing early
 * beats a structured clone of several megabytes that ends in an article nobody
 * wanted.
 */
export const MAX_PAGE_HTML = 8_000_000;

/**
 * @template T
 * @param {T} value
 * @returns {Result<T>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * @param {ErrorCodeValue} code
 * @returns {Result<never>}
 */
export function fail(code) {
  return { ok: false, code };
}

/**
 * Narrows what came back from the background. A malformed answer means the
 * background is broken, not the caller, so it becomes `internal` rather than an
 * exception in a content script that has a bubble open.
 *
 * @template T
 * @param {unknown} response
 * @returns {Result<T>}
 */
export function asResult(response) {
  if (typeof response !== "object" || response === null || !("ok" in response)) {
    return fail(ErrorCode.INTERNAL);
  }
  return /** @type {Result<T>} */ (response);
}

/**
 * Narrows the value of a successful translation. `asResult` checks that an
 * answer is an answer; this checks that it is the answer to this question -
 * which matters because a page can be running a content script from before an
 * update while the background is already the new one, and a bubble that throws
 * puts a stack trace in the console of somebody else's page.
 *
 * @param {unknown} value
 * @returns {Translation}
 */
export function asTranslation(value) {
  if (typeof value !== "object" || value === null) return { gloss: "", sentence: null, entries: [] };
  const { gloss, sentence, entries } = /** @type {Record<string, unknown>} */ (value);

  const answer = typeof gloss === "string" ? gloss : "";
  // The sentence is an extra to the gloss, so without a gloss there is nothing
  // for it to be extra to: a bubble with an empty first line and a "More" that
  // has something behind it is a state nobody should have to make sense of.
  const second = answer.length > 0 && typeof sentence === "string" ? sentence : null;

  return { gloss: answer, sentence: second, entries: answer.length > 0 ? asEntries(entries) : [] };
}

/**
 * Dictionary entries as they can be rendered, or none.
 *
 * Every field is checked rather than trusted, for the same reason as above and
 * one more: these strings started life in a file somebody downloaded, and the
 * gap between "the background sent an array of entries" and "the background is
 * an older version that sent something else" is exactly where a bubble would
 * throw into somebody's page.
 *
 * @param {unknown} value
 * @returns {DictEntry[]}
 */
function asEntries(value) {
  if (!Array.isArray(value)) return [];

  /** @type {DictEntry[]} */
  const entries = [];
  for (const one of value) {
    if (typeof one !== "object" || one === null) continue;
    const { dictionary, headword, senses } = /** @type {Record<string, unknown>} */ (one);
    if (!Array.isArray(senses)) continue;

    const lines = senses.filter((line) => typeof line === "string" && line.length > 0);
    if (lines.length === 0) continue;

    entries.push({
      dictionary: typeof dictionary === "string" ? dictionary : "",
      headword: typeof headword === "string" ? headword : "",
      senses: lines,
    });
  }

  return entries;
}

/**
 * Narrows whatever arrived over `runtime.sendMessage` - which is to say,
 * anything at all - to a request this extension sends.
 *
 * @param {unknown} message
 * @returns {Request | null}
 */
export function asRequest(message) {
  if (typeof message !== "object" || message === null) return null;
  const kind = /** @type {{ kind?: unknown }} */ (message).kind;

  if (kind === Message.OPEN_READER) return { kind: Message.OPEN_READER };
  if (kind === Message.OPEN_SETTINGS) return { kind: Message.OPEN_SETTINGS };
  if (kind === Message.LIST_PHRASES) return { kind: Message.LIST_PHRASES };
  if (kind === Message.READ_PAGE) return { kind: Message.READ_PAGE };

  const { text, translations, context } = /** @type {Record<string, unknown>} */ (message);

  if (kind === Message.TRANSLATE) {
    if (typeof text !== "string") return null;
    // A context that is not a string is dropped rather than refused: it is an
    // extra the answer does not depend on, and refusing would cost the reader
    // the translation over something they cannot see.
    return typeof context === "string"
      ? { kind: Message.TRANSLATE, text, context }
      : { kind: Message.TRANSLATE, text };
  }

  if (kind === Message.FORGET_PHRASE) {
    if (typeof text !== "string") return null;
    return { kind: Message.FORGET_PHRASE, text };
  }

  if (kind === Message.SAVE_PHRASE) {
    if (typeof text !== "string") return null;
    if (!Array.isArray(translations)) return null;
    if (!translations.every((one) => typeof one === "string")) return null;
    return { kind: Message.SAVE_PHRASE, text, translations };
  }

  return null;
}

/**
 * The other direction, and the whole of it. A content script answers exactly
 * one question from the background and ignores everything else that arrives -
 * including every request above, which is addressed to the background and would
 * otherwise be answered twice by whoever felt like it.
 *
 * @param {unknown} message
 * @returns {GrabPageRequest | null}
 */
export function asPageRequest(message) {
  if (typeof message !== "object" || message === null) return null;
  const kind = /** @type {{ kind?: unknown }} */ (message).kind;
  return kind === Message.GRAB_PAGE ? { kind: Message.GRAB_PAGE } : null;
}

/**
 * Narrows a page as it came off the wire. The reader is about to hand this to
 * an HTML parser and then to Readability, so "it is a string" is the difference
 * between a page that failed to arrive and a stack trace on the reader tab.
 *
 * @param {unknown} value
 * @returns {Page | null}
 */
export function asPage(value) {
  if (typeof value !== "object" || value === null) return null;
  const { url, title, html } = /** @type {Record<string, unknown>} */ (value);
  if (typeof url !== "string" || typeof html !== "string") return null;
  if (html.length === 0) return null;
  // A tab without a title is ordinary; the article's own heading is what the
  // reader shows anyway.
  return { url, title: typeof title === "string" ? title : "", html };
}
