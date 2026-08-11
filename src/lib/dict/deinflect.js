/**
 * Other forms of an English word to try when a dictionary has not heard of the
 * one that was selected.
 *
 * This is a lookup aid and nothing more. It never touches what gets saved,
 * never changes the key a phrase is stored under, and never decides what a
 * highlight matches - `read` still does not underline `reading`, which is a
 * limit the README states and this does not quietly repeal. All it does is ask
 * a dictionary a second question when the first one came back empty.
 *
 * Being wrong is cheap in one direction only, and that shapes everything here:
 * a form that does not exist simply misses (`bus` suggesting `bu` finds
 * nothing), while a form we fail to suggest is a word the reader was told
 * nothing about. So the rules over-generate on purpose and the dictionary does
 * the deciding.
 *
 * What is deliberately absent: irregular verbs. `went` is not `go` by any rule,
 * and the table that would say so is somebody else's data - which the .syn file
 * of a real dictionary already carries, entry by entry, in the dictionary's own
 * words.
 */

/** Below this, taking a suffix off produces noise rather than a word. */
const MIN_LENGTH = 2;

/** How many forms one word may suggest. Far above what the rules produce. */
const MAX_FORMS = 12;

/**
 * Suffix in, replacement out, most specific first - the order decides which
 * form is tried first, and `flies` should reach `fly` before it reaches `flie`.
 */
const RULES = Object.freeze([
  { suffix: "'s", replacement: "" },
  { suffix: String.fromCodePoint(0x2019) + "s", replacement: "" },
  { suffix: "iest", replacement: "y" },
  { suffix: "ies", replacement: "y" },
  { suffix: "ied", replacement: "y" },
  { suffix: "ier", replacement: "y" },
  { suffix: "ves", replacement: "f" },
  { suffix: "ves", replacement: "fe" },
  { suffix: "es", replacement: "" },
  { suffix: "s", replacement: "" },
  { suffix: "ed", replacement: "" },
  { suffix: "ed", replacement: "e" },
  { suffix: "ing", replacement: "" },
  { suffix: "ing", replacement: "e" },
  { suffix: "est", replacement: "" },
  { suffix: "est", replacement: "e" },
  { suffix: "er", replacement: "" },
  { suffix: "er", replacement: "e" },
  { suffix: "ly", replacement: "" },
]);

/** `stopped` loses `ed` and is left with a doubled consonant that was never in `stop`. */
const DOUBLED = /([bcdfghjklmnpqrstvwxz])\1$/u;

/**
 * @param {string} word already normalized: trimmed, folded, no edge punctuation
 * @returns {string[]} forms worth asking a dictionary about, best first, never
 *   including the word itself
 */
export function baseForms(word) {
  if (word.length < MIN_LENGTH) return [];

  /** @type {Set<string>} */
  const forms = new Set();

  /** @param {string} form */
  const offer = (form) => {
    if (form.length >= MIN_LENGTH && form !== word) forms.add(form);
  };

  for (const { suffix, replacement } of RULES) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length) + replacement;
    offer(stem);

    // `running` and `stopped` shed one letter more than the suffix. Only after
    // a verb ending, because `pass` and `bell` end in a double of their own.
    if (replacement === "" && (suffix === "ed" || suffix === "ing") && DOUBLED.test(stem)) {
      offer(stem.slice(0, -1));
    }
  }

  return [...forms].slice(0, MAX_FORMS);
}
