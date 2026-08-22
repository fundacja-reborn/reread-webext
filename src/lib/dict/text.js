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
 * What one meaning may cost, how many a word may have, and how much a
 * dictionary may say about itself.
 *
 * A dictionary entry can be an encyclopaedia article; the bubble is twenty-two
 * rem wide and sits over somebody's reading. The last two are for the settings
 * page: a dictionary's own description is often a licence, a history and a
 * thank-you note, and the row it sits in is a row, not a page. All four are
 * deliberately generous enough that a normal dictionary never notices them.
 */
export const LIMITS = Object.freeze({ senseLength: 1000, senses: 10, name: 120, credit: 400 });

/**
 * Elements that start or end a line for a reader, whatever they are in the
 * markup. Both ends of each: a dictionary that writes `<p>` per meaning and one
 * that writes `</p>` between them should read the same afterwards, and a blank
 * line either way costs nothing because empty lines are dropped.
 */
const LINE_BREAKS = /<\s*\/?\s*(?:br|p|div|li|tr|td|th|table|ul|ol|dl|dt|dd|blockquote|h[1-6])\b[^>]*>/giu;

/** XDXF wraps the headword in `<k>`, and the row already knows its headword. */
const XDXF_KEY = /<k>[\s\S]*?<\/k>/giu;

const TAG = /<[^>]*>/gu;

/**
 * The named entities a dictionary actually writes, and nothing beyond them.
 *
 * The full HTML table is some two thousand names, which is a table nobody here
 * would read; this is what turned up in real books. Five markup escapes, the
 * marks that separate or shape a line, and the punctuation an entry is set in -
 * `&mdash;` between a sense and its gloss, `&rsquo;` inside an English word,
 * `&lrm;` in an etymology beside a word from a right-to-left script. That last
 * one is how this list got longer: `even +&lrm; handed` reached the bubble with
 * the ampersand still in it, on a screenshot going to a store.
 *
 * Invisible marks are decoded rather than dropped, because in an entry quoting
 * Hebrew or Arabic they are what puts the punctuation on the right side of the
 * word. They are written by code point for the reason the project writes every
 * invisible character that way: a literal one is a character nobody sees in the
 * diff.
 */
const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",

  lrm: String.fromCodePoint(0x200e),
  rlm: String.fromCodePoint(0x200f),
  zwj: String.fromCodePoint(0x200d),
  zwnj: String.fromCodePoint(0x200c),
  shy: String.fromCodePoint(0x00ad),
  ensp: " ",
  emsp: " ",
  thinsp: " ",

  // Written by code point, not as themselves: the house style keeps a literal
  // em dash out of our own prose, and a dash decoded from a book is the book's
  // character rather than ours - it has to come out as what the book wrote.
  mdash: String.fromCodePoint(0x2014),
  ndash: String.fromCodePoint(0x2013),
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  sbquo: "‚",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  prime: "′",
  Prime: "″",

  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  middot: "·",
  bull: "•",
  dagger: "†",
  Dagger: "‡",
  sect: "§",
  para: "¶",
  copy: "©",
  reg: "®",
  trade: "™",
  micro: "µ",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
});

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (whole, body) => {
    const table = /** @type {Record<string, string>} */ (NAMED_ENTITIES);
    const written = String(body);
    // The spelling as written comes first: `&Prime;` and `&prime;` are two
    // different marks, and lower-casing everything would let the second answer
    // for both. Lower case second, so `&AMP;` still decodes.
    const named = table[written] ?? table[written.toLowerCase()];
    if (named !== undefined) return named;

    const name = written.toLowerCase();

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
 * What a dictionary says about itself, as something a settings page can print.
 *
 * The same treatment the entries get, and for the same reason: a `.ifo` file
 * describes the book in HTML - `<br>` between the lines of a licence, `<a>`
 * around the address it points at - and printed as text that reads as source
 * code. It is also frequently an essay, so it is cut to the length of a
 * paragraph somebody will actually read.
 *
 * @param {string | null} text as the .ifo had it
 * @param {number} [limit] how much of it is worth printing
 * @returns {string | null} null when there is nothing left to show
 */
export function about(text, limit = LIMITS.credit) {
  if (text === null) return null;
  const plain = clamp(fieldText({ type: "h", text }), limit);
  return plain.length > 0 ? plain : null;
}

/**
 * @param {import("./stardict.js").Field} field
 * @returns {string} plain text, empty when this field has nothing to show
 */
export function fieldText({ type, text }) {
  if (!READABLE.has(type)) return "";
  if (!MARKUP.has(type)) return tidy(text);

  // Everything that separates one line of an entry from the next is a line
  // break by now, so what is left is inline - `<b>`, `<font>`, the `<a>` around
  // a licence address - and inline tags join the text around them. Replacing
  // them with a space instead put one in front of every full stop that followed
  // a link, which is how a licence ends up reading "by WikDict .".
  const withoutMarkup = (type === "x" ? text.replace(XDXF_KEY, " ") : text)
    .replace(LINE_BREAKS, "\n")
    .replace(TAG, "");

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
