import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

/**
 * The committed rasters, read back the way a browser will read them. The
 * generator (`tools/icon/make-icons.mjs`) is dependency-free on purpose, which
 * also means nothing ever proof-read its output - so this suite is the second
 * reader: headers say what the manifest promises, and the pixels hold an
 * actual mark rather than a blank or a filled square.
 */

const SIZES = [16, 32, 48, 128];

/**
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
async function bytes(size) {
  return readFile(new URL(`../src/assets/icons/icon-${size}.png`, import.meta.url));
}

/**
 * @param {Buffer} png
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number }}
 */
function header(png) {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "not a PNG signature",
  );
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24] ?? 0,
    colorType: png[25] ?? 0,
  };
}

/**
 * RGBA rows out of the IDAT stream. Asserts the one filter the generator
 * writes, so a change there fails loudly instead of decoding garbage.
 *
 * @param {Buffer} png
 * @param {number} size
 * @returns {Buffer} `size * size * 4` bytes
 */
function pixels(png, size) {
  /** @type {Buffer[]} */
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = size * 4 + 1;
  assert.equal(raw.length, size * stride, "scanlines do not add up to the declared size");

  const out = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    assert.equal(raw[row * stride], 0, `scanline ${row} uses a filter the generator never writes`);
    raw.copy(out, row * size * 4, row * stride + 1, (row + 1) * stride);
  }
  return out;
}

describe("the rasterized icons", () => {
  for (const size of SIZES) {
    it(`icon-${size}.png is an 8-bit RGBA square of its name`, async () => {
      const png = await bytes(size);
      assert.deepEqual(header(png), { width: size, height: size, bitDepth: 8, colorType: 6 });
    });

    it(`icon-${size}.png holds the tile, its corners cut, the mark on it`, async () => {
      const rgba = pixels(await bytes(size), size);

      let ink = 0;
      for (let at = 3; at < rgba.length; at += 4) {
        ink += /** @type {number} */ (rgba[at]);
      }
      // The icon is a rounded tile filling the raster, so mean coverage sits
      // just under full - the corner radius is all that is missing (~4% at a
      // 22.5% radius). A blank file has none of it; a full square means the
      // radius stopped being applied. The band is wide on purpose - this
      // guards decoding, not taste.
      const share = ink / (255 * size * size);
      assert.ok(share > 0.7, `mean coverage ${(share * 100).toFixed(1)}% - blank?`);
      assert.ok(share < 0.98, `mean coverage ${(share * 100).toFixed(1)}% - a square, not a tile?`);

      // The rounding is what keeps the corner pixels clear.
      for (const [x, y] of /** @type {Array<[number, number]>} */ ([
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ])) {
        assert.equal(rgba[(y * size + x) * 4 + 3], 0, `corner ${x},${y} is inked`);
      }

      // A point in the tile's left margin at mid-height - inside the rounded
      // square everywhere, left of the mark (which spans the middle ~71% of
      // the width): solid, and solid in the accent amber. The channel order
      // alone catches a swapped or grayscale fill.
      const tile = ((size >> 1) * size + Math.round(size * 0.08)) * 4;
      assert.equal(rgba[tile + 3], 255, "tile interior is not opaque");
      assert.deepEqual(
        [rgba[tile], rgba[tile + 1], rgba[tile + 2]],
        [0xb8, 0x79, 0x1d],
        "tile interior is not the accent amber",
      );
    });
  }
});
