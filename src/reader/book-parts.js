/**
 * The parts of a book as they are written (D230): the sink both imports
 * feed - the EPUB's (`import-book.js`) and the Markdown text's
 * (`import-markdown.js`) - so that a book is one shape in the database
 * whichever file it came from. A segment closed by the packer is written
 * the moment it closes, its headings go into the table of contents (D116)
 * only here, where the packer's cuts and merges are all spoken for, and
 * its words are counted (D226) in the shape the reader will count them.
 * What the book's row needs at the end - how many parts, how heavy, how
 * many words, the contents - is what the writer has counted on the way.
 *
 * The same goes for the rows of the file's own contents (D277,
 * `lib/book/nav.js`): a block carries the rows that land on it through the
 * packer, and where the block stands - which part, which place in it - is
 * known only here, so here is where each row's place is noted.
 */

import { cappedToc, headingEntries } from "../lib/book/toc.js";
import { wordsIn } from "../lib/reader/length.js";
import { putBookSegment } from "../lib/store/books.js";

/**
 * A block as the packer carries it: its markup, the rows of the book's
 * pictures it shows (D183), so the segment it lands in can name them, and -
 * for a book whose file has a table of contents of its own (D277) - the
 * rows of that table which land on it, by their indexes in the file's list.
 *
 * @typedef {{ html: string, pictures: number[], rows?: number[] }} PackedBlock
 */

/**
 * @typedef {object} PartWriter
 * @property {(segments: Array<import("../lib/book/segment.js").Segment<PackedBlock>>) => Promise<void>} write
 *   the segments the packer closed, written in order
 * @property {() => number} written how many parts stand so far
 * @property {() => number} totalChars their weight, as the packer measured it
 * @property {() => number} words their words, as the reader counts them
 * @property {() => import("../lib/book/toc.js").TocEntry[]} toc the table of contents
 *   read off the headings, capped
 * @property {() => Map<number, import("../lib/book/nav.js").RowPlace>} places where the rows
 *   the blocks carried have landed, by row; a row met twice stands where it was met first
 */

/**
 * @param {string} bookId the id the parts are written under
 * @param {(written: number) => void} onPart told after every part written
 * @returns {PartWriter}
 */
export function partWriter(bookId, onPart) {
  let written = 0;
  let totalChars = 0;
  let words = 0;
  /** @type {import("../lib/book/toc.js").TocEntry[]} */
  const entries = [];
  /** @type {Map<number, import("../lib/book/nav.js").RowPlace>} */
  const places = new Map();
  return {
    async write(segments) {
      for (const segment of segments) {
        const blocks = segment.blocks.map((block) => block.html);
        // The rows of pictures this segment shows, each named once (D183):
        // what an opening of the part reads, and nothing of the book's
        // other parts.
        const pictures = [...new Set(segment.blocks.flatMap((block) => block.pictures))].sort(
          (a, b) => a - b,
        );
        await putBookSegment({ bookId, index: written, blocks, charCount: segment.charCount, pictures });
        entries.push(...headingEntries(blocks, written));
        // The file's own rows (D277) stand where their blocks do, now that
        // it is settled where that is.
        for (const [blockIndex, block] of segment.blocks.entries()) {
          for (const row of block.rows ?? []) {
            if (!places.has(row)) places.set(row, { segmentIndex: written, blockIndex });
          }
        }
        written += 1;
        totalChars += segment.charCount;
        words += wordsIn(blocks.join(""));
        onPart(written);
      }
    },
    written: () => written,
    totalChars: () => totalChars,
    words: () => words,
    toc: () => cappedToc(entries),
    places: () => places,
  };
}
