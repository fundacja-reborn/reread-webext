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
 * rem wide and sits over somebody's reading. The next two are for the settings
 * page: a dictionary's own description is often a licence, a history and a
 * thank-you note, and the row it sits in is a row, not a page. All four are
 * deliberately generous enough that a normal dictionary never notices them.
 *
 * `field` is how much of one raw field is read at all (D171): the markup is
 * stripped with regular expressions that walk to the end of the text for
 * every `<` they meet, so a field of megabytes with no `>` in it would cost
 * a quadratic hang before the clamp below ever saw it. Sixty-four kilobytes
 * is far more markup than the first thousand characters of any meaning need.
 */
export const LIMITS = Object.freeze({ senseLength: 1000, senses: 10, name: 120, credit: 400, field: 65536 });

/**
 * Elements that begin a paragraph for a reader, whatever they are in the
 * markup - a section, a heading, a note. Both ends of each: a dictionary that
 * writes `<p>` per section and one that writes `</p>` between them should read
 * the same afterwards, and a text after a closed paragraph is a paragraph of
 * its own. They come out as a blank line (D197): the bubble drops blank lines
 * (`toMeanings`, one press per line), and the popup's read-only field keeps
 * them as the space between sections - reader.dict writes an entry as
 * `<p><b>Noun</b></p><ol><li>...</li></ol><p><b>Verb</b></p>...`, and
 * flattened to one line per element it read as one long list (Michał's
 * screenshot, 2026-09-11).
 */
const PARAGRAPH_BREAKS = /<\s*\/?\s*(?:p|div|h[1-6]|blockquote|table|section|article)\b[^<>]*>/giu;

/**
 * Elements that begin a line: the opening tag only, and the list itself none
 * at all - its first item begins the first line. A list is one block of
 * lines, and `</li><li>` counted as two breaks would have put an empty line
 * between two senses; a closing tag ends its line silently, stripped with
 * the rest of the tags below.
 */
const LINE_BREAKS = /<\s*(?:br|li|tr|td|th|dt|dd)\b[^<>]*>/giu;

/**
 * Two or more `<br>` in a row: the one way an entry written in line breaks
 * says "paragraph", so it comes out as one - before the single breaks are
 * read.
 */
const BREAK_RUN = /(?:<\s*br\b[^<>]*>\s*){2,}/giu;

/**
 * Where a paragraph ends, on its way through `tidy` - a mark no text is made
 * of (private use), written by code point like every invisible character in
 * this project. Not whitespace on purpose: `tidy` trims whitespace off every
 * line, and the mark has to survive as a line of its own.
 */
const PARAGRAPH_MARK = String.fromCodePoint(0xe000);

/** One or more paragraph ends in a row, with the line breaks around them. */
const PARAGRAPH_RUN = new RegExp(`\\n?(?:${PARAGRAPH_MARK}\\n?)+`, "gu");

/** XDXF wraps the headword in `<k>`, and the row already knows its headword. */
const XDXF_KEY = /<k>[\s\S]*?<\/k>/giu;

/**
 * A tag runs to the first `>` and never across another `<` (D171). With
 * `[^>]*` a field of `<` signs with no `>` after them made every one of them
 * walk to the end of the field and back - quadratic in the field, which is
 * the kind of field a hostile dictionary would write. A `<` inside a tag is
 * not markup any dictionary writes, so nothing honest reads differently.
 */
const TAG = /<[^<>]*>/gu;

/**
 * WikDict's source annotations, which are not markup and not content.
 *
 * Wiktionary's pronunciation lines carry references and qualifiers, and the
 * WikDict build writes them into the field as ENTITIES - `&lt;ref:&lt;&lt;
 * name:Dobson&gt;&gt;&gt;`, `&lt;a:obsolete&gt;`, sometimes a whole wiki
 * template (`&lt;ref:{{R:en:Dobson:1957|II|334|986}}&gt;`). The tag strip
 * cannot touch them (they are not tags yet), and decoding is what makes them
 * visible - `/ʃuːld/<ref:<<name:Dobson>>>/` reached a bubble on Michał's
 * screenshot. Only these names, and only with the colon: a stray `<` a
 * dictionary honestly writes (an entry about `a < b`) matches nothing here.
 *
 * The names are the ones the files actually write, counted in the raw en-pl
 * and pl-en WikDict builds and reader.dict's English edition (2026-09-12):
 * `a` (456 in en-pl, an accent - "affricated"), `q` (281, a qualifier -
 * "verb", "contemporary"), `ref` (146), `name` (112, inside a `ref`), `aa`
 * (25, "Northern England"), `qq` (18, "dated", "senses 2-4"), `t` (2,
 * "measuring device"), and reader.dict's `tr` (27, a transliteration the
 * entry already gives in brackets beside it). All of them qualify the word
 * they stand after - which sense, which accent, which age, which script -
 * and none is text a reader would keep, so they go with their contents.
 *
 * The inside allows `<<...>>` pairs, `{{...}}` templates and anything that is
 * not an angle bracket, so a nested reference is eaten whole rather than to
 * its first `>`.
 */
const SOURCE_NOTE = "<(?:ref|name|aa?|qq?|tr?):(?:<<[^<>]*>>|\\{\\{[^{}]*\\}\\}|[^<>])*>";

/**
 * Markup a build wrote as entities - `&lt;sup&gt;j&lt;/sup&gt;` in the pl-en
 * transcriptions (395 lines), `&lt;sup &gt;` before a citation's link in
 * reader.dict (57) - which the decoding turns back into tags after the tag
 * strip has run. Their contents are text (the glide's `j`, the link) and
 * stay; the tags go. Only these two: a dictionary that honestly writes
 * `&lt;i&gt;` as text about the tag keeps it (the test says so).
 */
const DECODED_TAGS = /<\/?(?:sup|sub)\b[^<>]*>/giu;

/**
 * A note standing between two slashes of a transcription - the common case:
 * `/ʃuːld/<ref:...>/, /ʃəd/`. Dropping the note alone would leave `//`, so
 * the slash it leans on goes with it and the next one stays.
 */
const NOTED_SLASH = new RegExp(`/(?:${SOURCE_NOTE})+(?=/)`, "gu");

const SOURCE_NOTES = new RegExp(SOURCE_NOTE, "gu");

/**
 * The annotations out, wherever the decoding surfaced them - and in a plain
 * `m` field, where a build may write them as themselves.
 *
 * @param {string} text
 * @returns {string}
 */
function stripSourceNotes(text) {
  return text.replace(NOTED_SLASH, "").replace(SOURCE_NOTES, "");
}

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
 * Line breaks kept, paragraph ends kept as one blank line, everything else
 * squeezed: an entry that arrives as one line per meaning should read as one
 * line per meaning, an entry that arrives with forty spaces of XML
 * indentation should not, and an entry in sections should keep its sections
 * apart (D197). However many paragraph ends stand in a row, one blank line
 * is what they come out as, and none at either edge.
 *
 * A blank line in a plain-text field is a paragraph end too - it is what a
 * plain book means by one. In markup it is not: there the tags say where
 * the paragraphs are, and an empty line is what two breaks in a row leave
 * behind (`</p>` and the `<li>` after it), so it is dropped as before.
 *
 * @param {string} text
 * @param {boolean} [blankLineEndsParagraph]
 * @returns {string}
 */
function tidy(text, blankLineEndsParagraph = true) {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .map((line) => (line.length === 0 && blankLineEndsParagraph ? PARAGRAPH_MARK : line))
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(PARAGRAPH_RUN, "\n\n")
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
export function fieldText({ type, text: raw }) {
  if (!READABLE.has(type)) return "";
  // Cut before any expression runs over it (see LIMITS.field); what the cut
  // leaves is clamped again, to a sentence's length, at the end.
  const text = raw.length > LIMITS.field ? raw.slice(0, LIMITS.field) : raw;
  if (!MARKUP.has(type)) return tidy(stripSourceNotes(text));

  // Everything that separates one section or one line of an entry from the
  // next is a paragraph mark or a line break by now, so what is left is
  // inline - `<b>`, `<font>`, the `<a>` around a licence address, the closing
  // tags of lines - and inline tags join the text around them. Replacing
  // them with a space instead put one in front of every full stop that followed
  // a link, which is how a licence ends up reading "by WikDict .".
  const withoutMarkup = (type === "x" ? text.replace(XDXF_KEY, " ") : text)
    .replace(BREAK_RUN, `\n${PARAGRAPH_MARK}\n`)
    .replace(PARAGRAPH_BREAKS, `\n${PARAGRAPH_MARK}\n`)
    .replace(LINE_BREAKS, "\n")
    .replace(TAG, "");

  // The source annotations and the decoded tags after the decoding, because
  // the decoding is what surfaces them (see SOURCE_NOTE, DECODED_TAGS).
  return tidy(stripSourceNotes(decodeEntities(withoutMarkup)).replace(DECODED_TAGS, ""), false);
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
