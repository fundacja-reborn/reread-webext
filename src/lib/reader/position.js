/**
 * The rules of the reading position, with no DOM and no database in sight -
 * the same split as `saved-article.js` next to `articles.js`, so that every
 * decision here runs under `node --test`.
 *
 * A position is a structural anchor, `{segmentIndex, blockIndex}`: which
 * top-level block of which segment was at the top of the screen. Structural
 * rather than a scroll offset because the offset breaks at the first change
 * of font size or measure, while the block order is rebuilt identically from
 * the same stored markup every time. Articles are one segment (`segmentIndex`
 * 0); books, when they come, will use the same record with a real index.
 *
 * Losing a position must never cost more than starting a document from the
 * top, which is why everything here answers `null` rather than throwing: a
 * torn row, a stale index, a document that shrank - all of them mean "the
 * top", never an error anybody has to read.
 */

/**
 * How long after the last scroll the position is written, in milliseconds.
 * Long enough that a page being scrolled through is not written about at
 * every step, short enough that closing a tab a breath after stopping still
 * finds the position saved.
 */
export const POSITION_SAVE_DELAY = 1500;

/**
 * @typedef {{
 *   docId: string,
 *   segmentIndex: number,
 *   blockIndex: number,
 *   updatedAt: number,
 * }} ReadingPosition
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isIndex(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Builds the record a save writes, or nothing when there is nothing worth
 * writing - no document to belong to, or an index that is not a place.
 *
 * @param {string} docId
 * @param {number} segmentIndex
 * @param {number} blockIndex
 * @param {number} now
 * @returns {ReadingPosition | null}
 */
export function positionRecord(docId, segmentIndex, blockIndex, now) {
  if (typeof docId !== "string" || docId.length === 0) return null;
  if (!isIndex(segmentIndex) || !isIndex(blockIndex)) return null;
  if (typeof now !== "number" || !Number.isFinite(now)) return null;
  return { docId, segmentIndex, blockIndex, updatedAt: now };
}

/**
 * A row as it came back from the database, narrowed field by field. Anything
 * short of a whole position reads as no position at all - half an anchor
 * points nowhere.
 *
 * @param {unknown} value
 * @returns {ReadingPosition | null}
 */
export function asPosition(value) {
  if (typeof value !== "object" || value === null) return null;
  const { docId, segmentIndex, blockIndex, updatedAt } =
    /** @type {Record<string, unknown>} */ (value);
  if (typeof docId !== "string" || docId.length === 0) return null;
  if (!isIndex(segmentIndex) || !isIndex(blockIndex)) return null;
  return {
    docId,
    segmentIndex,
    blockIndex,
    updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

/**
 * The block to scroll to when a document opens, or `null` for the top. `null`
 * covers every way a stored position can fail to be a place in the document
 * on screen: no record, a record about another segment, an index past the end
 * of a document that has since been overwritten by a shorter one.
 *
 * @param {ReadingPosition | null} position
 * @param {number} segmentIndex the segment being rendered
 * @param {number} blockCount how many top-level blocks it has
 * @returns {number | null}
 */
export function restoredIndex(position, segmentIndex, blockCount) {
  if (position === null) return null;
  if (position.segmentIndex !== segmentIndex) return null;
  if (position.blockIndex >= blockCount) return null;
  return position.blockIndex;
}

/**
 * Which block a horizontal line through the page falls on: the first whose
 * bottom edge is still below the line - the block being read when the line is
 * the top of the visible text. This is the fallback of the save measurement,
 * for when `elementFromPoint` lands on something that is not a block: the
 * margin between two paragraphs, or the bubble standing over the point.
 *
 * Scrolled past everything, the last block is the answer - there is no
 * further place to mean. An empty document has no place at all.
 *
 * @param {Array<{ bottom: number }>} rects the blocks' rects, in block order
 * @param {number} y the line, in the same coordinates
 * @returns {number | null}
 */
export function blockAtLine(rects, y) {
  if (rects.length === 0) return null;
  const at = rects.findIndex((rect) => rect.bottom > y);
  return at === -1 ? rects.length - 1 : at;
}
