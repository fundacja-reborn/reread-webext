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
 */

import { cappedToc, headingEntries } from "../lib/book/toc.js";
import { wordsIn } from "../lib/reader/length.js";
import { putBookSegment } from "../lib/store/books.js";

/**
 * A block as the packer carries it: its markup, and the rows of the book's
 * pictures it shows (D183), so the segment it lands in can name them.
 *
 * @typedef {{ html: string, pictures: number[] }} PackedBlock
 */

/**
 * @typedef {object} PartWriter
 * @property {(segments: Array<import("../lib/book/segment.js").Segment<PackedBlock>>) => Promise<void>} write
 *   the segments the packer closed, written in order
 * @property {() => number} written how many parts stand so far
 * @property {() => number} totalChars their weight, as the packer measured it
 * @property {() => number} words their words, as the reader counts them
 * @property {() => import("../lib/book/toc.js").TocEntry[]} toc the table of contents, capped
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
  };
}
