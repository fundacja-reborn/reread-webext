/**
 * The vendored ZIP library as this extension uses it: the synchronous
 * single-entry reads the book import has always made, and - since the
 * reading list's backup learned to carry pictures (D145) - the synchronous
 * writer. Nothing asynchronous: that path spawns Web Workers from `Blob`
 * URLs, which is exactly the kind of dynamic code an auditor should be able
 * to rule out (`vendor/fflate/README.md`). Loaded once, the first time an
 * import or export actually needs it - the reader page in its usual life
 * never pays for it.
 */

/**
 * @typedef {{ name: string, size: number, originalSize: number }} ZipEntryInfo
 * @typedef {{
 *   unzipSync: (
 *     data: Uint8Array,
 *     opts?: { filter?: (file: ZipEntryInfo) => boolean },
 *   ) => Record<string, Uint8Array>,
 *   zipSync: (data: Record<string, [Uint8Array, { level: number }]>) => Uint8Array<ArrayBuffer>,
 * }} FflateModule
 */

/** @type {FflateModule | null} */
let fflate = null;

/**
 * A dynamic import of the copied file rather than a bundled one, so what
 * runs is byte-for-byte what `vendor/fflate/CHECKSUMS` pins. The specifier
 * is written for the built package, where `vendor/` stands beside
 * `reader/`; the build marks it external so it survives bundling verbatim.
 *
 * @returns {Promise<FflateModule>}
 */
export async function loadFflate() {
  if (fflate === null) {
    fflate = /** @type {FflateModule} */ (
      // @ts-expect-error - the path exists only in the built package (the
      // vendored file is copied, never bundled), so the checker cannot
      // resolve it from the source tree.
      await import("../vendor/fflate/browser.js")
    );
  }
  return fflate;
}

/**
 * Every entry's name and sizes, without inflating one: the directory is
 * scanned, and a filter that keeps nothing leaves it at that.
 *
 * @param {Uint8Array} bytes the whole archive
 * @returns {Promise<ZipEntryInfo[]>}
 */
export async function listEntries(bytes) {
  const { unzipSync } = await loadFflate();
  /** @type {ZipEntryInfo[]} */
  const infos = [];
  unzipSync(bytes, {
    filter: (info) => {
      infos.push(info);
      return false;
    },
  });
  return infos;
}

/**
 * A reader of single entries by name, each refused before inflating when
 * the directory says it is larger than `cap` - or missing. Synchronous
 * once made, so a loop over an article's pictures needs no await per one.
 *
 * @param {Uint8Array} bytes the whole archive
 * @returns {Promise<(name: string, cap: number) => Uint8Array | null>}
 */
export async function entryReader(bytes) {
  const { unzipSync } = await loadFflate();
  return (name, cap) => {
    const out = unzipSync(bytes, {
      filter: (info) => info.name === name && info.originalSize <= cap,
    });
    return out[name] ?? null;
  };
}

/**
 * The archive an export writes: deflated where the entry is text, stored
 * where it is a picture that is compressed already - a JPEG through
 * deflate is the same size and the time it took.
 *
 * @param {{ name: string, data: Uint8Array, deflate: boolean }[]} entries
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function packArchive(entries) {
  const { zipSync } = await loadFflate();
  /** @type {Record<string, [Uint8Array, { level: number }]>} */
  const data = {};
  for (const entry of entries) data[entry.name] = [entry.data, { level: entry.deflate ? 6 : 0 }];
  return zipSync(data);
}
