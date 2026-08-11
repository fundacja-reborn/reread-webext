/**
 * Turning whatever a dictionary entry is written in into the plain text a
 * bubble can show.
 *
 * This happens **once, at import**, and that is the whole point. Dictionaries
 * arrive as HTML, as Pango markup, as XDXF, and as plain text, from files
 * somebody downloaded off the internet - exactly the kind of string this
 * extension refuses to put anywhere near `innerHTML`. Reducing it to text at
 * the door means the database holds text, the message carries text, and the
 * bubble sets `textContent`, with nothing left to sanitise later.
 *
 * Tags are stripped with a regular expression rather than a parser. `DOMParser`
 * would be more correct about malformed markup, but it means building a
 * document per entry, three hundred thousand times, to reach `textContent` -
 * and the worst a stray `<` can do to the output here is stay a `<`.
 */

/** Markup types, in the sense of "has tags that have to come off". */
const MARKUP = new Set(["h", "g", "x", "w", "k"]);

/**
 * Types worth keeping as text. Everything else is a sound, a picture or a file
 * list.
 *
 * `l` is the format's one non-UTF-8 type - a meaning in whatever encoding the
 * machine that built the dictionary happened to use, which nothing in the file
 * names. It is decoded as UTF-8 like everything else and comes out as mojibake
 * when it was not: a defect visible in the entry, on a type no dictionary
 * published this century uses, and cheaper than guessing at encodings.
 */
const READABLE = new Set(["m", "l", "t", "y", "n", ...MARKUP]);

/**
 * What one meaning may cost, and how many a word may have.
 *
 * A dictionary entry can be an encyclopaedia article; the bubble is twenty-two
 * rem wide and sits over somebody's reading. These two numbers are where that
 * gets decided, and they are deliberately generous enough that a normal entry
 * never notices them.
 */
export const LIMITS = Object.freeze({ senseLength: 1000, senses: 10 });

/**
 * Elements that start or end a line for a reader, whatever they are in the
 * markup. Both ends of each: a dictionary that writes `<p>` per meaning and one
 * that writes `</p>` between them should read the same afterwards, and a blank
 * line either way costs nothing because empty lines are dropped.
 */
const LINE_BREAKS = /<\s*\/?\s*(?:br|p|div|li|tr|dt|dd|blockquote|h[1-6])\b[^>]*>/giu;

/** XDXF wraps the headword in `<k>`, and the row already knows its headword. */
const XDXF_KEY = /<k>[\s\S]*?<\/k>/giu;

const TAG = /<[^>]*>/gu;

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
});

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (whole, body) => {
    const name = String(body).toLowerCase();
    const named = /** @type {Record<string, string>} */ (NAMED_ENTITIES)[name];
    if (named !== undefined) return named;

    if (name.startsWith("#")) {
      const code = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      // Anything outside Unicode, and the surrogate range, would throw.
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
    }

    return whole;
  });
}

/**
 * Line breaks kept, everything else squeezed: an entry that arrives as one
 * paragraph per meaning should read as one line per meaning, and an entry that
 * arrives with forty spaces of XML indentation should not.
 *
 * @param {string} text
 * @returns {string}
 */
function tidy(text) {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function clamp(text, limit) {
  if (text.length <= limit) return text;
  // Cut on a space when there is one nearby, so the tail is a word and not a
  // syllable. The ellipsis says the entry goes on; the dictionary still has it.
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit - 40 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * @param {import("./stardict.js").Field} field
 * @returns {string} plain text, empty when this field has nothing to show
 */
export function fieldText({ type, text }) {
  if (!READABLE.has(type)) return "";
  if (!MARKUP.has(type)) return tidy(text);

  const withoutMarkup = (type === "x" ? text.replace(XDXF_KEY, " ") : text)
    .replace(LINE_BREAKS, "\n")
    .replace(TAG, " ");

  return tidy(decodeEntities(withoutMarkup));
}

/**
 * One word's fields, as the meanings a reader will see.
 *
 * A phonetic transcription is not a meaning, so it joins the line it belongs
 * to rather than taking one of its own: `watch` reading `/wɒtʃ/ zegarek` is one
 * answer, `watch` reading `/wɒtʃ/` and then `zegarek` is two, and the first of
 * them says nothing.
 *
 * @param {import("./stardict.js").Field[]} fields
 * @returns {string[]}
 */
export function senses(fields) {
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  let pending = [];

  for (const field of fields) {
    const text = fieldText(field);
    if (text.length === 0) continue;

    if (field.type === "t" || field.type === "y") {
      pending.push(text);
      continue;
    }

    found.push(clamp([...pending, text].join(" "), LIMITS.senseLength));
    pending = [];
  }

  // A transcription with nothing after it is all this entry had.
  if (pending.length > 0) found.push(clamp(pending.join(" "), LIMITS.senseLength));

  return found.slice(0, LIMITS.senses);
}
