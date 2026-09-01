/**
 * The rules of a highlighter mark, with no DOM and no database in sight - the
 * same split as `position.js`, so that every decision here runs under
 * `node --test`.
 *
 * A mark is a structural anchor with a quote riding along. The anchor is a
 * pair of points, `{block, offset}` each: which top-level block of the rebuilt
 * article, and where in that block's joined prose text (`prosePieces`, the
 * read-aloud walk) the mark begins and ends. Structural for the reason the
 * reading position is: the same stored markup rebuilds into the same blocks
 * and the same prose every time, while anything measured in pixels breaks at
 * the first change of font or measure. Unlike the position, a mark cannot
 * afford to be *approximately* right - a wash over the wrong words is worse
 * than no wash - so the quote is the guard: at paint time the text under the
 * anchor has to read back exactly as it was written down, or the mark stays
 * unpainted (and untouched in the database, where an export can still carry
 * it). Losing paint costs highlighting again; painting the wrong words would
 * cost trust.
 *
 * Word alignment is deliberately not a rule here. The gesture that creates a
 * mark snaps to the matcher's tokens, so every mark is born on word edges -
 * but what is stored are plain character offsets, and painting one back needs
 * no tokenizer at all.
 */

/**
 * The colours a mark may wear, and the one it wears by default. Names rather
 * than values, because a colour has to answer differently per theme - the
 * stylesheet holds a wash for each name in each theme - and because a name is
 * what can be checked at the door: a stored colour is a registry name in the
 * making, never a string that reaches CSS.
 *
 * @typedef {"yellow" | "green" | "blue" | "pink"} MarkColor
 */

/** @type {readonly MarkColor[]} */
export const MARK_COLORS = Object.freeze(["yellow", "green", "blue", "pink"]);

/** @type {MarkColor} */
export const DEFAULT_MARK_COLOR = "yellow";

/**
 * The most a note may hold, in characters. Far above what a margin comment
 * honestly runs to - the cap exists for the same reason the article file caps
 * its marks: a hand-made backup must not plant megabytes into a field every
 * render reads. The editor wears the same number as its `maxlength`, so the
 * two doors agree.
 */
export const MAX_NOTE_LENGTH = 2000;

/**
 * A note as a mark keeps it, or nothing: trimmed, cut to the cap, and absent
 * rather than empty - a mark without a note has no field, so "no note" is one
 * shape everywhere. One narrowing for the record builder and the healer both,
 * so a note entered by editor and one entered by file read by the same rule.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asNote(value) {
  if (typeof value !== "string") return undefined;
  // The trim after the cut keeps the healing idempotent: a cut that lands on
  // a space must read the same on every later pass through this door.
  const kept = value.trim().slice(0, MAX_NOTE_LENGTH).trim();
  return kept.length === 0 ? undefined : kept;
}

/**
 * @param {unknown} value
 * @returns {value is MarkColor}
 */
export function isMarkColor(value) {
  return typeof value === "string" && MARK_COLORS.includes(/** @type {MarkColor} */ (value));
}

/**
 * One end of a mark: a top-level block of the rebuilt article, and a
 * character offset into that block's joined prose text. The end point's
 * offset is exclusive, the usual half-open reading.
 *
 * @typedef {{ block: number, offset: number }} MarkPoint
 */

/**
 * The optional `note` is the reader's own words about the quote (D118):
 * absent on a mark nobody annotated - old rows never carried the field, and
 * absence and emptiness must read the same - and plain text when present,
 * newlines and all.
 *
 * @typedef {{
 *   segmentIndex: number,
 *   start: MarkPoint,
 *   end: MarkPoint,
 *   color: string,
 *   createdAt: number,
 *   text: string,
 *   note?: string,
 * }} Mark
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isIndex(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @returns {MarkPoint | null}
 */
function asPoint(value) {
  if (typeof value !== "object" || value === null) return null;
  const { block, offset } = /** @type {Record<string, unknown>} */ (value);
  if (!isIndex(block) || !isIndex(offset)) return null;
  return { block, offset };
}

/**
 * Which of two points comes first in the article: blocks in document order,
 * offsets within a block. Both ends of every comparison this module makes.
 *
 * @param {MarkPoint} a
 * @param {MarkPoint} b
 * @returns {number}
 */
export function comparePoints(a, b) {
  return a.block - b.block || a.offset - b.offset;
}

/**
 * The reading order of marks: segment by segment, then by where each begins.
 * The end breaks ties only so that sorting is total - two marks sharing a
 * start cannot survive `placeMark` anyway.
 *
 * @param {Mark} a
 * @param {Mark} b
 * @returns {number}
 */
export function compareMarks(a, b) {
  return (
    a.segmentIndex - b.segmentIndex ||
    comparePoints(a.start, b.start) ||
    comparePoints(a.end, b.end)
  );
}

/**
 * Builds the record a finished gesture writes, or nothing when the pieces do
 * not make a mark: a span that does not run forward, an unknown colour, a
 * quote that is not there to guard with. An end offset of zero is refused
 * with the rest - a mark "ending" at the very start of a block really ends in
 * the block before, and the gesture never produces one. The note alone
 * cannot refuse a record: whatever it holds narrows through `asNote`, and a
 * mark is a mark with or without one.
 *
 * @param {{
 *   segmentIndex: number,
 *   start: MarkPoint,
 *   end: MarkPoint,
 *   color: string,
 *   createdAt: number,
 *   text: string,
 *   note?: string,
 * }} input
 * @returns {Mark | null}
 */
export function markRecord({ segmentIndex, start, end, color, createdAt, text, note }) {
  if (!isIndex(segmentIndex)) return null;
  const from = asPoint(start);
  const to = asPoint(end);
  if (from === null || to === null) return null;
  if (comparePoints(from, to) >= 0 || to.offset === 0) return null;
  if (!isMarkColor(color)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (typeof text !== "string" || text.length === 0) return null;
  const kept = asNote(note);
  return {
    segmentIndex,
    start: from,
    end: to,
    color,
    createdAt,
    text,
    ...(kept === undefined ? {} : { note: kept }),
  };
}

/**
 * A mark as it came back from the database or a file, narrowed field by
 * field. The lean is the vocabulary's: these are somebody's marks in their
 * own reading, so a wound that can heal, heals - an unknown colour becomes
 * the default, a broken clock reads as zero - and only a mark without a
 * whole anchor or without its quote is dropped, because those two are what
 * painting it stands on.
 *
 * @param {unknown} value
 * @returns {Mark | null}
 */
export function asMark(value) {
  if (typeof value !== "object" || value === null) return null;
  const { segmentIndex, start, end, color, createdAt, text, note } =
    /** @type {Record<string, unknown>} */ (value);
  return markRecord({
    segmentIndex: /** @type {number} */ (segmentIndex),
    start: /** @type {MarkPoint} */ (start),
    end: /** @type {MarkPoint} */ (end),
    color: isMarkColor(color) ? color : DEFAULT_MARK_COLOR,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    text: /** @type {string} */ (text),
    note: typeof note === "string" ? note : undefined,
  });
}

/**
 * A bare span - what a gesture knows before it is a mark, and what merging
 * reasons about.
 *
 * @typedef {{ segmentIndex: number, start: MarkPoint, end: MarkPoint }} MarkSpan
 */

/**
 * Whether two spans of the same segment share ground or stand back to back.
 * Touching counts: two washes meeting end to start read as one to the eye,
 * and keeping them as two would be a seam nobody drew on purpose.
 *
 * @param {MarkSpan} a
 * @param {MarkSpan} b
 * @returns {boolean}
 */
function joined(a, b) {
  if (a.segmentIndex !== b.segmentIndex) return false;
  return comparePoints(a.start, b.end) <= 0 && comparePoints(b.start, a.end) <= 0;
}

/**
 * What painting a new span over the standing marks means: which marks it
 * absorbs, and the one span covering them all. Drawing over a mark is how a
 * mark grows - there are no handles to drag - so overlap is never two marks
 * stacked, always one mark that got bigger. The quote of the union is the
 * document's to give, not this module's: the caller reads it off the blocks
 * and finishes the record.
 *
 * @param {Mark[]} marks
 * @param {MarkSpan} span
 * @returns {{ absorbed: Mark[], span: MarkSpan }}
 */
export function mergePlan(marks, span) {
  const absorbed = marks.filter((mark) => joined(mark, span));
  let { start, end } = span;
  for (const mark of absorbed) {
    if (comparePoints(mark.start, start) < 0) start = mark.start;
    if (comparePoints(mark.end, end) > 0) end = mark.end;
  }
  return { absorbed, span: { segmentIndex: span.segmentIndex, start, end } };
}

/**
 * The note the merged mark inherits: every absorbed note, in reading order,
 * a blank line between two - because absorbing a mark absorbs somebody's own
 * words, and a growth gesture silently eating a note would be the one loss
 * this feature cannot afford. Exact twins collapse to one: the same sentence
 * twice says nothing the once does not. Undefined when no absorbed mark had
 * a word to pass on, so the fresh record simply has no field.
 *
 * @param {Mark[]} absorbed
 * @returns {string | undefined}
 */
export function mergedNote(absorbed) {
  /** @type {string[]} */
  const notes = [];
  for (const mark of [...absorbed].sort(compareMarks)) {
    if (mark.note !== undefined && !notes.includes(mark.note)) notes.push(mark.note);
  }
  return notes.length === 0 ? undefined : notes.join("\n\n");
}

/**
 * The list as it stands once a merged mark lands: the absorbed rows out, the
 * new one in, reading order kept. Absorption is by identity - the absorbed
 * marks are elements of the very list being replaced.
 *
 * @param {Mark[]} marks
 * @param {Mark[]} absorbed
 * @param {Mark} mark
 * @returns {Mark[]}
 */
export function placeMark(marks, absorbed, mark) {
  const kept = marks.filter((one) => !absorbed.includes(one));
  return [...kept, mark].sort(compareMarks);
}

/**
 * The list without one mark - the delete button's whole arithmetic.
 *
 * @param {Mark[]} marks
 * @param {Mark} mark
 * @returns {Mark[]}
 */
export function withoutMark(marks, mark) {
  return marks.filter((one) => one !== mark);
}

/**
 * The marks of one segment, for painting: an article is all of segment zero,
 * a book paints one part at a time.
 *
 * @param {Mark[]} marks
 * @param {number} segmentIndex
 * @returns {Mark[]}
 */
export function marksInSegment(marks, segmentIndex) {
  return marks.filter((mark) => mark.segmentIndex === segmentIndex);
}

/**
 * The shape of a box as the pickers below need it - what a DOMRect already
 * is, said structurally so the rule can run under `node --test`.
 *
 * @typedef {{ top: number, bottom: number, left: number, right: number,
 *   width: number, height: number }} RectLike
 */

/**
 * Which of a painted range's boxes a mark visually begins in, and which it
 * ends in. Blink does not hand a range's client rects in document order -
 * boxes arrive grouped by node when the range crosses inline elements, with
 * zero-size boxes riding along for collapsed whitespace - so "the first
 * rect" and "the last rect" are not "the first line" and "the last line"
 * (the note badge stood mid-mark on exactly that; Michał's report from
 * Brave). Geometry decides instead: the head is the topmost box and the
 * tail the bottommost, ties broken toward the reading edge, and an empty
 * box is nobody's line. Null only when nothing has size.
 *
 * @param {Iterable<RectLike>} rects
 * @returns {RectLike | null}
 */
export function headRect(rects) {
  /** @type {RectLike | null} */
  let best = null;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (best === null || rect.top < best.top || (rect.top === best.top && rect.left < best.left)) {
      best = rect;
    }
  }
  return best;
}

/**
 * @param {Iterable<RectLike>} rects
 * @returns {RectLike | null}
 */
export function tailRect(rects) {
  /** @type {RectLike | null} */
  let best = null;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      best === null ||
      rect.bottom > best.bottom ||
      (rect.bottom === best.bottom && rect.right > best.right)
    ) {
      best = rect;
    }
  }
  return best;
}

/**
 * The text a span covers, read off the blocks' prose - or null when the
 * offsets do not fit the prose they claim to measure, which is the quote
 * guard refusing. `prose` holds the joined text of every block the span
 * touches, first to last; a line break stands between blocks, the same one
 * `prosePieces` puts inside them, so a quote reads like the text it quotes.
 *
 * Used in both directions on purpose: writing a mark builds its quote here,
 * and painting one rebuilds the quote the same way and compares. One
 * function, so the two can never disagree about what a span says.
 *
 * @param {string[]} prose
 * @param {MarkPoint} start offset into `prose[0]`
 * @param {MarkPoint} end offset into `prose[prose.length - 1]`, exclusive
 * @returns {string | null}
 */
export function quoteOf(prose, start, end) {
  const first = prose[0];
  const last = prose[prose.length - 1];
  if (first === undefined || last === undefined) return null;
  if (prose.length !== end.block - start.block + 1) return null;
  if (start.offset >= first.length) return null;
  if (end.offset < 1 || end.offset > last.length) return null;

  if (prose.length === 1) return first.slice(start.offset, end.offset);
  return [first.slice(start.offset), ...prose.slice(1, -1), last.slice(0, end.offset)].join("\n");
}

/**
 * Where a quote stands in a segment's prose when it stands in exactly one
 * place - the healed anchor of a mark the guard refused (D169: a paragraph
 * added above, a sanitizer that tightened, a book cut again from its own
 * file). The prose is the blocks' texts as `quoteOf` joins them - a line
 * break at every boundary - so a quote written by `quoteOf` is looked for in
 * the very text it was read from, and read back through `quoteOf` before it
 * is believed. One hit and no other: a quote standing twice is nobody's to
 * choose between, and painting the wrong one would cost what the guard
 * protects. Null for none, for two or more, and for a quote whose ends fall
 * on a boundary no record can name.
 *
 * @param {string[]} prose every block of the segment, in order
 * @param {string} quote
 * @returns {{ start: MarkPoint, end: MarkPoint } | null}
 */
export function findQuote(prose, quote) {
  if (quote.length === 0 || prose.length === 0) return null;
  const joined = prose.join("\n");
  const at = joined.indexOf(quote);
  if (at === -1 || joined.indexOf(quote, at + 1) !== -1) return null;

  const start = pointAt(prose, at);
  const last = pointAt(prose, at + quote.length - 1);
  if (start === null || last === null) return null;
  const end = { block: last.block, offset: last.offset + 1 };
  const read = quoteOf(prose.slice(start.block, end.block + 1), start, end);
  return read === quote ? { start, end } : null;
}

/**
 * The block and offset a position in the joined prose falls in - or null on
 * a line break between blocks, a place no character of any block owns, and
 * past the end.
 *
 * @param {string[]} prose
 * @param {number} index into `prose.join("\n")`
 * @returns {MarkPoint | null}
 */
function pointAt(prose, index) {
  let from = 0;
  for (const [block, text] of prose.entries()) {
    if (index < from + text.length) return { block, offset: index - from };
    if (index === from + text.length) return null;
    from += text.length + 1;
  }
  return null;
}
