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
 * `toc` is the book's table of contents (D116): the h1-h3 rows of its own
 * segments, riding the metadata because it is read whenever the book is and
 * is dozens of entries at most (capped at import). Three states, and the
 * difference between the last two is what drives the backfill: an array is
 * a scanned book (possibly with nothing found - the empty array), `null` is
 * a row from before the TOC existed, still owed a scan.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   author: string | null,
 *   lang: string | null,
 *   segmentCount: number,
 *   totalChars: number,
 *   addedAt: number,
 *   readAt: number | null,
 *   toc: import("../book/toc.js").TocEntry[] | null,
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
 * @param {unknown} value
 * @returns {value is number}
 */
function isIndex(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * A table of contents narrowed entry by entry, or nothing. All or nothing
 * on purpose: one torn entry means the field cannot be trusted, and `null`
 * is the state the backfill heals - a partial list kept instead would read
 * as scanned and stand forever.
 *
 * @param {unknown} value
 * @returns {import("../book/toc.js").TocEntry[] | null}
 */
function asToc(value) {
  if (!Array.isArray(value)) return null;
  /** @type {import("../book/toc.js").TocEntry[]} */
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { title, level, segmentIndex, blockIndex } = /** @type {Record<string, unknown>} */ (
      entry
    );
    if (typeof title !== "string" || title.length === 0) return null;
    if (level !== 1 && level !== 2 && level !== 3) return null;
    if (!isIndex(segmentIndex) || !isIndex(blockIndex)) return null;
    entries.push({ title, level, segmentIndex, blockIndex });
  }
  return entries;
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
 *   toc?: import("../book/toc.js").TocEntry[],
 * }} input
 * @returns {BookMeta | null}
 */
export function bookRecord({ id, title, author, lang, segmentCount, totalChars, addedAt, toc }) {
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
    // An import always scanned - a torn list is written as "scanned, nothing
    // found", never as the null that would put a fresh book in the backfill
    // queue for a list the import itself could not produce.
    toc: asToc(toc) ?? [],
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
  const { id, title, author, lang, segmentCount, totalChars, addedAt, readAt, toc } =
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
    // Absent on rows from before D116 and whenever an entry does not narrow;
    // both read as "still owed a scan", which the next open provides.
    toc: asToc(toc),
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
