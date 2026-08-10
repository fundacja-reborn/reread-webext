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

/** Message kinds. The `kind` field is the discriminator on every request. */
export const Message = Object.freeze({
  TRANSLATE: "translate",
  OPEN_READER: "open-reader",
  OPEN_SETTINGS: "open-settings",
  SAVE_PHRASE: "save-phrase",
  FORGET_PHRASE: "forget-phrase",
  LIST_PHRASES: "list-phrases",
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
 * A translate request carries the text and nothing else: the language pair
 * lives in the settings, the settings live in the background, and a content
 * script that never has to look them up is a content script that cannot
 * disagree with the background about which pair is configured. The same is true
 * of every request below - phrases are addressed by their text, and the
 * background is the only side that normalizes it.
 *
 * Saving replaces the meanings of a phrase with the ones given, which is what
 * makes "the phrase means exactly what the bubble is showing" one rule instead
 * of two messages.
 *
 * @typedef {{ kind: typeof Message.TRANSLATE, text: string }} TranslateRequest
 * @typedef {{ kind: typeof Message.OPEN_READER }} OpenReaderRequest
 * @typedef {{ kind: typeof Message.OPEN_SETTINGS }} OpenSettingsRequest
 * @typedef {{ kind: typeof Message.SAVE_PHRASE, text: string, translations: string[] }} SavePhraseRequest
 * @typedef {{ kind: typeof Message.FORGET_PHRASE, text: string }} ForgetPhraseRequest
 * @typedef {{ kind: typeof Message.LIST_PHRASES }} ListPhrasesRequest
 * @typedef {TranslateRequest
 *   | OpenReaderRequest
 *   | OpenSettingsRequest
 *   | SavePhraseRequest
 *   | ForgetPhraseRequest
 *   | ListPhrasesRequest} Request
 */

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

  const { text, translations } = /** @type {Record<string, unknown>} */ (message);

  if (kind === Message.TRANSLATE) {
    if (typeof text !== "string") return null;
    return { kind: Message.TRANSLATE, text };
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
