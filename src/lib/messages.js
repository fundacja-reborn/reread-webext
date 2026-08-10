/**
 * Every error code, said in a sentence a reader can act on.
 *
 * Keeping this in one module is what makes the rule in `protocol.js` real: a
 * new code that nobody can phrase does not get added, because the switch below
 * stops compiling without it.
 *
 * English only for now. When the UI is worth translating, this is the module
 * that grows a catalogue - `_locales/` and `i18n.getMessage` - and every other
 * file stays as it is.
 */

import { ErrorCode } from "./protocol.js";

/**
 * @param {import("./protocol.js").ErrorCodeValue} code
 * @returns {string}
 */
export function describeError(code) {
  switch (code) {
    case ErrorCode.ENGINE_MISSING:
      return "No translation engine yet - this build cannot translate.";
    case ErrorCode.MODEL_MISSING:
      // Not "not downloaded": a model can just as well be added from files, and
      // the sentence has to be true either way. What the reader needs is where
      // to fix it, and that both ways of fixing it are there.
      return "No model for this language pair on this device - download or add one in the settings.";
    case ErrorCode.UNSUPPORTED_PAIR:
      return "No model exists for this language pair.";
    case ErrorCode.TOO_LONG:
      return "That selection is too long to translate.";
    case ErrorCode.UNKNOWN_MESSAGE:
      return "The extension sent a request it does not understand.";
    case ErrorCode.INTERNAL:
      return "Something went wrong inside the extension.";
    default:
      return "Something went wrong inside the extension.";
  }
}
