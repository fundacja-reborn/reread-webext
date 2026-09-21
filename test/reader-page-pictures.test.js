import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pageTops } from "../src/lib/reader/pages.js";

// A picture on a page of its own (D276). Read by pages, a book's cover came
// out cut in two at every window's height - its first lines at the foot of
// the head's page and the rest opening the next page mid-picture, or its
// last lines opening the page after it (Michał's report from a Boox Page and
// from the emulator, 2026-09-21). Two causes, both held here:
//
//  - the stylesheet capped a picture at the window less the bar, which is
//    taller than the band a page's lines stand in (the tab under the bar,
//    the two margins, the foot) - so the cover did not fit the page it was
//    sized for, and a line taller than a page can only be cut at the edge.
//    The cap is the band itself now, handed over by the script;
//  - cut back from the page being read (D238), a page could open a few
//    pixels into a picture that DID fit: when nothing else began between
//    the picture and the page below, the cut fell at the band's edge.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), "utf8");

/** @typedef {{ top: number, bottom: number }} Box */

/**
 * The opening of a book as the reader lays it out in a 552 x 707 window: the
 * head (the acts, the note, the title block), the cover, the text. The band
 * is 561 tall and begins at 94. The cover is one block holding one picture,
 * `inset` pixels inside it (a wrapper's padding; none by default).
 *
 * @param {number} coverHeight
 * @param {{ inset?: number, plain?: boolean }} [how] `plain`: the cutter is
 *   told of no lines in the cover's block - the shape of a block of controls,
 *   and of the pictures in the older tests
 */
function opening(coverHeight, how = {}) {
  const inset = how.inset ?? 0;
  const coverTop = 350;
  const coverBottom = coverTop + coverHeight + 2 * inset;
  const textTop = coverBottom + 20;
  /** @type {Box[]} */
  const blocks = [
    { top: 94, bottom: 130 },
    { top: 150, bottom: 175 },
    { top: 190, bottom: 330 },
    { top: coverTop, bottom: coverBottom },
    { top: textTop, bottom: textTop + 60 * 25 },
  ];
  const picture = { top: coverTop + inset, bottom: coverTop + inset + coverHeight };
  /** @type {(index: number) => Box[]} */
  const linesOf = (index) => {
    if (index === 3) return how.plain === true ? [] : [picture];
    if (index === 4) return Array.from({ length: 60 }, (_, line) => ({ top: textTop + line * 25, bottom: textTop + (line + 1) * 25 }));
    return [];
  };
  return { blocks, linesOf, picture, textTop };
}

const BAND = { top: 94, height: 561 };

/**
 * Whether the picture stands whole on the page that holds its top: no page
 * opens inside it, and a band's worth from that page's top reaches its foot.
 *
 * @param {number[]} tops
 * @param {Box} picture
 */
function wholeOnOnePage(tops, picture) {
  for (const top of tops) {
    assert.ok(!(top > picture.top + 1 && top < picture.bottom - 1), `a page opens inside the picture, at ${top} (${picture.top}-${picture.bottom}): ${tops.slice(0, 5).join(", ")}`);
  }
  let page = tops[0] ?? 0;
  for (const top of tops) if (top <= picture.top + 1) page = top;
  assert.ok(picture.bottom <= page + BAND.height + 1, `the picture's foot (${picture.bottom}) is past the page opened at ${page}`);
}

describe("a cover that fits the band", () => {
  it("stands whole on a page of its own, cut from the head", () => {
    const { blocks, linesOf, picture, textTop } = opening(545);
    const tops = pageTops(blocks, linesOf, BAND.height, BAND.top);
    assert.deepEqual(tops.slice(0, 3), [94, 350, textTop]);
    wholeOnOnePage(tops, picture);
  });

  it("stands whole on a page of its own cut back from the page after it - the reported cut", () => {
    // The book reopened on its first page of text, or the pages cut again
    // while it was being read: the table is cut back from that page's top,
    // and the edge of the page before it falls a few pixels into the cover.
    const { blocks, linesOf, picture, textTop } = opening(545);
    const tops = pageTops(blocks, linesOf, BAND.height, BAND.top, textTop);
    assert.deepEqual(tops.slice(0, 3), [94, 350, textTop]);
    wholeOnOnePage(tops, picture);
  });

  it("is the same table whichever page it is cut from", () => {
    const { blocks, linesOf, picture } = opening(545);
    const canonical = pageTops(blocks, linesOf, BAND.height, BAND.top);
    for (const anchor of canonical.slice(1, 5)) {
      const tops = pageTops(blocks, linesOf, BAND.height, BAND.top, anchor);
      wholeOnOnePage(tops, picture);
      assert.ok(tops.includes(350), `anchored at ${anchor}, no page opens on the cover: ${tops.slice(0, 5).join(", ")}`);
    }
  });

  it("does so at the very cap: a picture exactly as tall as the band", () => {
    for (const how of [{}, { plain: true }]) {
      const { blocks, linesOf, picture, textTop } = opening(BAND.height, how);
      wholeOnOnePage(pageTops(blocks, linesOf, BAND.height, BAND.top), picture);
      wholeOnOnePage(pageTops(blocks, linesOf, BAND.height, BAND.top, textTop), picture);
    }
  });

  it("does so inside a wrapper with padding of its own, whose box is taller than the band", () => {
    const { blocks, linesOf, picture, textTop } = opening(550, { inset: 12 });
    const head = pageTops(blocks, linesOf, BAND.height, BAND.top);
    wholeOnOnePage(head, picture);
    assert.ok(head.includes(picture.top), "the page opens on the picture, not on the wrapper's padding");
    wholeOnOnePage(pageTops(blocks, linesOf, BAND.height, BAND.top, textTop), picture);
  });

  it("does so for a block the cutter is told no lines of", () => {
    const { blocks, linesOf, picture, textTop } = opening(545, { plain: true });
    wholeOnOnePage(pageTops(blocks, linesOf, BAND.height, BAND.top), picture);
    assert.deepEqual(pageTops(blocks, linesOf, BAND.height, BAND.top, textTop).slice(0, 3), [94, 350, textTop]);
  });

  it("holds for every height of cover and band a window may come up with", () => {
    for (let height = 300; height <= 700; height += 37) {
      for (const fraction of [0.35, 0.6, 0.85, 0.97, 1]) {
        const { blocks, linesOf, picture, textTop } = opening(Math.floor(height * fraction));
        const band = { top: 94, height };
        const check = (/** @type {number[]} */ tops) => {
          for (const top of tops) assert.ok(!(top > picture.top + 1 && top < picture.bottom - 1), `band ${height}, cover ${picture.bottom - picture.top}: a page opens at ${top}`);
        };
        check(pageTops(blocks, linesOf, band.height, band.top));
        check(pageTops(blocks, linesOf, band.height, band.top, textTop));
        check(pageTops(blocks, linesOf, band.height, band.top, textTop + 10 * 25));
      }
    }
  });
});

describe("a picture taller than the band", () => {
  it("is still cut at the edge both ways, because every other cut would lose a strip of it", () => {
    // What the stylesheet's first cap produced: 605 of picture in a band of
    // 561. Nothing of it may fall between two pages - each page shows a
    // band's worth from its top, so the pages inside it are a band apart.
    const { blocks, linesOf, picture, textTop } = opening(605);
    const head = pageTops(blocks, linesOf, BAND.height, BAND.top);
    assert.deepEqual(head.slice(0, 3), [94, 350, 350 + BAND.height]);
    const back = pageTops(blocks, linesOf, BAND.height, BAND.top, textTop);
    assert.deepEqual(back.slice(0, 3), [94, textTop - BAND.height, textTop]);
    assert.ok(picture.bottom - picture.top > BAND.height);
  });
});

describe("the reader's page holds a picture to the band it measures", () => {
  const script = read("src/reader/reader.js");
  const css = read("src/reader/reader.css");

  /**
   * One function of the reader's script, from its name to the next one's.
   *
   * @param {string} name
   * @param {string} next
   */
  function fn(name, next) {
    const from = script.indexOf(`function ${name}(`);
    const to = script.indexOf(`function ${next}(`, from);
    assert.ok(from >= 0 && to > from, `${name} before ${next}`);
    return script.slice(from, to);
  }

  it("hands the band's height to the stylesheet in whole pixels, rounded down, and only when it moves", () => {
    const fit = fn("fitPictures", "flowBlocks");
    assert.match(fit, /const whole = Math\.floor\(height\);/);
    assert.match(fit, /if \(whole <= 0 \|\| whole === pictureBand\) return false;/);
    assert.match(fit, /document\.documentElement\.style\.setProperty\("--page-band-h", `\$\{whole\}px`\);/);
  });

  it("does it with the cut - never under a finger - and measures the document laid out with it", () => {
    const cut = fn("pagesNow", "pageShown");
    const held = cut.indexOf("if (same && pointerHeld) {");
    const fitted = cut.indexOf("const laidOut = fitPictures(height) ? document.documentElement.scrollHeight : extent;");
    const measured = cut.indexOf("const blocks = flowBlocks();");
    assert.ok(held >= 0 && fitted > held, "the pictures are resized before the held pointer is asked about");
    assert.ok(measured > fitted, "the blocks are measured before the pictures are held to the band");
    // The table remembers the document as it stands after the cap moved, or
    // the next ask would find the extent changed and cut the pages again.
    assert.match(cut, /extent: laidOut,/);
  });

  it("caps a picture by the band, with a cap safely under any band until it is measured", () => {
    assert.match(
      css,
      /:root\[data-reader-layout="paged"\] #content :is\(img, picture, video\) \{\n  max-height: var\(--page-band-h, calc\(100dvh - var\(--header-h\) - var\(--foot-h\) - 4rem\)\);\n  object-fit: contain;\n\}/,
    );
    // The first cap counted the window less the bar, and was taller than the
    // band by the tab, the margins and the foot.
    assert.doesNotMatch(css, /max-height: calc\(100dvh - var\(--header-h\) - 2\.5rem\);/);
  });

  it("leaves a caption room on its picture's page", () => {
    assert.match(
      css,
      /:root\[data-reader-layout="paged"\] #content figure:has\(figcaption\) :is\(img, video\) \{\n  max-height: calc\(var\(--page-band-h, [^;]+\) - 3lh - 0\.6rem\);\n\}/,
    );
  });

  it("changes nothing about a scrolled document", () => {
    assert.match(fn("pagesNow", "pageShown"), /if \(!paged\(\)\) return null;/);
    assert.doesNotMatch(css, /\n#content img \{[^}]*--page-band-h/);
  });
});
