/**
 * Turning a language code into something a person recognises.
 *
 * The names come from the browser's own `Intl.DisplayNames`, not from a table
 * in this package: the labels match what the browser calls the same languages
 * everywhere else, there is nothing for us to keep up to date, and nothing to
 * audit beyond this file. The one massaging needed is the underscore -
 * Mozilla's model index writes `zh_hant`, BCP-47 writes `zh-Hant`, and
 * `Intl.DisplayNames` only reads the latter.
 *
 * A code with no name - malformed, private, or simply unknown to the browser -
 * comes back as itself. A code on screen is poorer than a name, but it is
 * honest, and it still tells apart the two things it needs to tell apart.
 */

/** @type {Intl.DisplayNames | null} */
let names = null;

/**
 * @param {string} code as the model registry writes it, e.g. `"en"`, `"zh_hant"`
 * @returns {string} `"English"`, or the code itself when there is no name for it
 */
export function languageName(code) {
  // The pages of this extension are English for now; when locales arrive, the
  // page language belongs here.
  names ??= new Intl.DisplayNames(["en"], { type: "language" });
  try {
    return names.of(code.replace(/_/g, "-")) ?? code;
  } catch {
    return code;
  }
}

/**
 * The one way a direction is written on screen, so every page writes it the
 * same way.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function pairLabel(from, to) {
  return `${languageName(from)} to ${languageName(to)}`;
}
