/**
 * The shape of an imported book, with no database in sight - the same split
 * as `saved-article.js` next to `articles.js`, so that everything this module
 * decides runs under `node --test`.
 *
 * A book is metadata here and nothing else: its text lives as segments in
 * their own store, and the list must be renderable without a single one of
 * them entering memory. `readAt` means what it means for articles - set and
 * cleared only by hand, because opening a book is not reading it.
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   author: string | null,
 *   lang: string | null,
 *   segmentCount: number,
 *   totalChars: number,
 *   addedAt: number,
 *   readAt: number | null,
 * }} BookMeta
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * A short token worth carrying, or nothing - the same rule the articles
 * apply to `dir` and `lang`, because these end up as attributes and labels.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function keptWord(value) {
  if (typeof value !== "string") return null;
  const word = value.trim();
  return word.length > 0 && word.length <= 80 ? word : null;
}

/**
 * Builds the row an import writes, or nothing when what came out of the file
 * is not a book anybody could open: no id to find it by again, no title to
 * show (the caller falls back to the file's name before asking), or not a
 * single segment of text.
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   author?: string | null,
 *   lang?: string | null,
 *   segmentCount: number,
 *   totalChars: number,
 *   addedAt: number,
 * }} input
 * @returns {BookMeta | null}
 */
export function bookRecord({ id, title, author, lang, segmentCount, totalChars, addedAt }) {
  if (typeof id !== "string" || id.length === 0) return null;
  const shown = typeof title === "string" ? title.trim() : "";
  if (shown.length === 0) return null;
  if (!isCount(segmentCount)) return null;
  if (typeof totalChars !== "number" || !Number.isFinite(totalChars) || totalChars <= 0) return null;
  if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) return null;

  return {
    id,
    title: shown,
    author: keptWord(author),
    lang: keptWord(lang),
    segmentCount,
    totalChars: Math.floor(totalChars),
    addedAt,
    readAt: null,
  };
}

/**
 * A row as it came back from the database, narrowed field by field. The lean
 * is toward keeping it - the segments behind it are somebody's book - but a
 * row without an id or without a single segment names nothing to open, and
 * reads as absent.
 *
 * @param {unknown} value
 * @returns {BookMeta | null}
 */
export function asBookMeta(value) {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, author, lang, segmentCount, totalChars, addedAt, readAt } =
    /** @type {Record<string, unknown>} */ (value);
  if (typeof id !== "string" || id.length === 0) return null;
  if (!isCount(segmentCount)) return null;

  return {
    id,
    title: typeof title === "string" && title.length > 0 ? title : id,
    author: keptWord(author),
    lang: keptWord(lang),
    segmentCount: /** @type {number} */ (segmentCount),
    totalChars:
      typeof totalChars === "number" && Number.isFinite(totalChars) && totalChars > 0
        ? totalChars
        : 0,
    addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : 0,
    readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null,
  };
}

/**
 * A stored segment's blocks, or null for a row not worth rendering. The
 * blocks are our own rebuilt markup, but they are narrowed all the same -
 * the same wariness the article content gets on its way out.
 *
 * @param {unknown} value
 * @returns {{ blocks: string[], charCount: number } | null}
 */
export function asSegment(value) {
  if (typeof value !== "object" || value === null) return null;
  const { blocks, charCount } = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  if (!blocks.every((block) => typeof block === "string")) return null;
  return {
    blocks: /** @type {string[]} */ (blocks),
    charCount: typeof charCount === "number" && Number.isFinite(charCount) ? charCount : 0,
  };
}
