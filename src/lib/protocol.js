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
 * A translate request carries the text and nothing else: the language pair
 * lives in the settings, the settings live in the background, and a content
 * script that never has to look them up is a content script that cannot
 * disagree with the background about which pair is configured.
 *
 * @typedef {{ kind: typeof Message.TRANSLATE, text: string }} TranslateRequest
 * @typedef {{ kind: typeof Message.OPEN_READER }} OpenReaderRequest
 * @typedef {TranslateRequest | OpenReaderRequest} Request
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

  if (kind === Message.OPEN_READER) {
    return { kind: Message.OPEN_READER };
  }

  if (kind === Message.TRANSLATE) {
    const { text } = /** @type {Record<string, unknown>} */ (message);
    if (typeof text !== "string") return null;
    return { kind: Message.TRANSLATE, text };
  }

  return null;
}
