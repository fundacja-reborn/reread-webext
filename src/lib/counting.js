/**
 * The rules of the two counts a saved phrase carries (D209), with no DOM and
 * no database in them: what a page tallies before it reports, what the
 * reader may count as a finished text, and what the background adds up
 * from a report. The row's own arithmetic is in `store/phrase.js`
 * (`counted`); this is everything on the way there.
 *
 * Two counts, two gestures. A bubble opening is reported as it happens - a
 * press on an underline, or a selection of a phrase already kept - and the
 * page batches them for the idle moment after. A text counts as finished
 * only through the gestures that prove the reader reached its end: the Next
 * button under a book part's text, and Mark as read - which, over a book,
 * counts the part on screen and never the whole book, so the parts already
 * counted on the way are not counted twice. Nothing else counts: not
 * opening a text, not scrolling it, not the Next button in the bar above
 * it, not a page the reader never finished.
 */

/** @typedef {import("./store/phrase.js").Counts} Counts */

/**
 * Which parts of which document the reader already counted, so that one
 * pass over a part is one count however the reader moves: Next under the
 * text, Previous, Next again in one sitting is one reading of that part.
 * The memory is one document deep - opening another document forgets the
 * first, and opening the first again tomorrow counts its parts again,
 * which is what a second reading is. It lives in the reader page's memory
 * and nowhere else: a reload forgets too, and that is the cheaper error.
 */
export class ReadLedger {
  /** @type {string} */
  #document = "";
  /** @type {Set<number>} */
  #parts = new Set();

  /**
   * @param {string} document the document's own id - a saved article's
   *   address, a book's id
   * @param {number} part the part on screen, zero for an article
   * @returns {boolean} whether this part is now claimed for the first time
   *   since the document was last opened
   */
  claim(document, part) {
    if (document !== this.#document) {
      this.#document = document;
      this.#parts.clear();
    }
    if (this.#parts.has(part)) return false;
    this.#parts.add(part);
    return true;
  }
}

/**
 * The occurrences a page painted, tallied by the saved phrase they belong
 * to. A painted range names the text it matched, which under D208 may be
 * a form of the saved word rather than the word - `keyOf` says which key
 * the form stands for, and null for a text that is nobody's (a form whose
 * key was learned a moment ago). Sorted by key so that two tallies of the
 * same page are the same list.
 *
 * @param {Iterable<string>} painted the normalized text of every painted
 *   range, one entry per occurrence
 * @param {(normalized: string) => string | null} keyOf
 * @returns {Array<[string, number]>}
 */
export function tallyRead(painted, keyOf) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const normalized of painted) {
    const key = keyOf(normalized);
    if (key === null) continue;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A report added up by key, the shape the store writes: every key once,
 * with everything the report said about it. `recalled` may name a key
 * more than once - the page opened its bubble more than once before the
 * batch went - and each naming is one opening; `read` may too, when two
 * reports were joined, and the counts add.
 *
 * @param {{ recalled: string[], read: Array<[string, number]> }} report
 * @returns {Map<string, Counts>}
 */
export function mergeCounts(report) {
  /** @type {Map<string, Counts>} */
  const counts = new Map();
  /**
   * @param {string} key
   * @returns {Counts}
   */
  const line = (key) => {
    let one = counts.get(key);
    if (one === undefined) {
      one = { recalled: 0, read: 0 };
      counts.set(key, one);
    }
    return one;
  };
  for (const key of report.recalled) line(key).recalled += 1;
  for (const [key, count] of report.read) line(key).read += count;
  return counts;
}

/**
 * What a page has to report, gathered between two flushes: openings as they
 * came, and the tallies of the texts finished meanwhile - joined into one
 * message so that a finished part and the bubble opened on its last line
 * wake the background once, not twice.
 */
export class CountReport {
  /** @type {string[]} */
  #recalled = [];
  /** @type {Array<[string, number]>} */
  #read = [];

  /** @param {string} key a saved phrase's own key */
  recalled(key) {
    this.#recalled.push(key);
  }

  /** @param {Array<[string, number]>} tally what `tallyRead` found */
  read(tally) {
    this.#read.push(...tally);
  }

  /** @returns {boolean} */
  isEmpty() {
    return this.#recalled.length === 0 && this.#read.length === 0;
  }

  /**
   * Everything gathered, and the report emptied - what one message carries.
   *
   * @returns {{ recalled: string[], read: Array<[string, number]> } | null} null when there was nothing
   */
  take() {
    if (this.isEmpty()) return null;
    const batch = { recalled: this.#recalled, read: this.#read };
    this.#recalled = [];
    this.#read = [];
    return batch;
  }
}
