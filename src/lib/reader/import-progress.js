/**
 * How far an import has come, as the page can say it: the work a picked
 * file means, counted before the first write, and a meter that turns the
 * writes into a bar and a line.
 *
 * An import of a large backup on a slow device takes minutes, and until
 * 2026-11-12 the page said nothing in that time - a press on Import greyed
 * the button and that was all, so the press was repeated, cancelled and
 * repeated again (Michał's report from a Boox Page). The rules live here,
 * away from the page, so `node --test` can hold them down.
 */

/**
 * How many phrases weigh what one written article does. The vocabulary is
 * written by the background in one message, so the bar cannot move inside
 * it; the weight only decides how far the bar stands when it is done.
 */
const PHRASES_PER_UNIT = 20;

/**
 * @typedef {{
 *   articles: number,
 *   pictures: number,
 *   books: { parts: number, pictures: number }[],
 *   phrases: number,
 *   highlights: number,
 * }} ImportWork what the import will write: the articles it adds and the
 *   pictures they name, each book it adds with its parts and pictures, the
 *   phrases the file holds, the documents whose highlights it holds
 */

/**
 * @typedef {{
 *   articles: number,
 *   pictures: number,
 *   books: number,
 *   phrases: number,
 *   highlights: number,
 *   total: number,
 * }} ImportUnits the same work in the bar's units, stage by stage
 */

/**
 * One book in the bar's units: a step per part written, a step per picture
 * kept, and one for the row that makes the book exist (and its copy).
 *
 * @param {{ parts: number, pictures: number }} book
 * @returns {number}
 */
export function bookUnits(book) {
  return book.parts + book.pictures + 1;
}

/**
 * The work in the bar's units. An article counts twice - once written,
 * once copied to the browser's own copy of the library, which on a phone
 * is the slower half - so the bar moves through both.
 *
 * @param {ImportWork} work
 * @returns {ImportUnits}
 */
export function importUnits(work) {
  const articles = work.articles * 2;
  const pictures = work.pictures;
  const books = work.books.reduce((sum, book) => sum + bookUnits(book), 0);
  const phrases = Math.ceil(work.phrases / PHRASES_PER_UNIT);
  const highlights = work.highlights;
  return { articles, pictures, books, phrases, highlights, total: articles + pictures + books + phrases + highlights };
}

/**
 * How many pictures the archive names for these articles - the pictures'
 * stage counted before it runs, and again from the articles actually added.
 *
 * @param {Map<string, unknown[]>} refs the archive's references by article
 * @param {string[]} urls
 * @returns {number}
 */
export function pictureCount(refs, urls) {
  return urls.reduce((sum, url) => sum + (refs.get(url)?.length ?? 0), 0);
}

/**
 * @typedef {{
 *   stage: (label: () => string, units: number) => void,
 *   step: (units?: number) => void,
 *   refresh: () => void,
 * }} ProgressMeter
 */

/**
 * The meter between the writes and the screen. A stage begins where the
 * stages before it were planned to end, whatever they managed to count, so
 * a stage that wrote less than planned (a picture the archive did not
 * give) leaves no gap and one that wrote more never runs past its share.
 *
 * It paints when a stage begins, when asked to (`refresh` - the stage's
 * line changed without a step), and otherwise only when the bar moves a
 * whole percent: a hundred repaints for the longest import, not one per
 * row - on e-ink every repaint is a flash. The line is asked for at the
 * paint, so it says the count as it stands then.
 *
 * @param {number} total the units of the whole import
 * @param {(fraction: number, label: string) => void} paint
 * @returns {ProgressMeter}
 */
export function progressMeter(total, paint) {
  const whole = Math.max(1, Math.floor(total));
  /** Where the standing stage begins, and how much of the bar is its own. */
  let start = 0;
  let span = 0;
  let within = 0;
  /** @type {() => string} */
  let label = () => "";
  let shown = -1;

  /** @param {boolean} always */
  const show = (always) => {
    const done = Math.min(whole, start + within);
    const percent = Math.floor((done / whole) * 100);
    if (!always && percent === shown) return;
    shown = percent;
    paint(percent / 100, label());
  };

  return {
    stage(next, units) {
      start = Math.min(whole, start + span);
      span = Math.max(0, Math.min(Math.floor(units), whole - start));
      within = 0;
      label = next;
      show(true);
    },
    step(units = 1) {
      within = Math.min(span, within + Math.max(0, units));
      show(false);
    },
    refresh() {
      show(true);
    },
  };
}
