/**
 * Reading a zip archive, and refusing everything a zip can be that a
 * dictionary download is not.
 *
 * This exists for one caller: the dictionary catalogue downloads WikDict's
 * `.zip` files, and an archive fetched by the extension has to be opened by
 * the extension. It is deliberately not a zip library. The whole format it
 * accepts is the one those files use - a handful of entries, stored or
 * deflated - and everything else is a refusal with a reason: zip64, encryption,
 * other compression methods, more entries or bytes than a dictionary could be.
 * The browser supplies the actual decompression (`DecompressionStream`), so
 * what this file owns is the container: headers, offsets, sizes, checksums.
 *
 * Sizes and the CRC-32 come from the archive's central directory, and both are
 * enforced after decompression. That is not the checksum story the model
 * registry has - the sums here are the archive's own, they travel with the
 * download and vouch only for its consistency, not its origin. The trust
 * boundary for dictionaries is the StarDict parser behind this; the checks
 * here just make sure what reaches it is exactly what the archive said it was.
 *
 * Nothing here touches the network or the browser beyond `DecompressionStream`,
 * so `node --test` drives every path - including the truncated, lying and
 * hostile archives a smoke test would never meet.
 */

/**
 * @typedef {"not_zip" | "zip_unsupported" | "zip_bad" | "zip_too_big"} ZipProblem
 */

/**
 * @typedef {object} ZipEntry
 * @property {string} name as stored in the archive, directories already dropped
 * @property {Uint8Array} bytes unpacked content
 */

/**
 * @typedef {{ ok: true, value: ZipEntry[] } | { ok: false, problem: ZipProblem, detail?: string }} ZipResult
 */

/**
 * What a dictionary archive is allowed to be. WikDict's largest is a few
 * megabytes holding four files; the room above that is for other dictionaries,
 * not other kinds of payload.
 */
const LIMITS = Object.freeze({
  entries: 64,
  totalBytes: 256 * 1024 * 1024,
  nameLength: 512,
});

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The two markers zip64 archives use where the classic fields overflow. */
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

/** @type {Uint32Array | null} */
let crcTable = null;

/**
 * CRC-32 as zip defines it. Built here rather than imported: the browser
 * exposes no CRC, and thirty lines beat a dependency in a package whose point
 * is being readable.
 *
 * @param {Uint8Array} bytes
 * @returns {number} unsigned
 */
export function crc32(bytes) {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = /** @type {number} */ (crcTable[(crc ^ byte) & 0xff]) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {DataView} view
 * @returns {number} offset of the End of Central Directory record, or -1
 */
function findEndOfCentralDirectory(view) {
  // The record is at the very end unless a comment follows it, and a comment
  // is at most 65535 bytes. Scanning backwards finds the real record first
  // even if the comment happens to contain the signature bytes.
  const floor = Math.max(0, view.byteLength - 22 - MAX_U16);
  for (let at = view.byteLength - 22; at >= floor; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/**
 * @param {Uint8Array<ArrayBuffer>} compressed a view into the downloaded archive
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(compressed) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ZipProblem} problem
 * @param {string} [detail]
 * @returns {{ ok: false, problem: ZipProblem, detail?: string }}
 */
function refuse(problem, detail) {
  return { ok: false, problem, ...(detail === undefined ? {} : { detail }) };
}

/**
 * One entry of the central directory, already sanity-checked.
 *
 * @typedef {object} CentralEntry
 * @property {string} name
 * @property {number} method
 * @property {number} crc
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} localOffset
 */

/**
 * @param {ArrayBuffer} buffer the archive as downloaded
 * @returns {Promise<ZipResult>} files only - directory entries are dropped
 */
export async function readZip(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 22) return refuse("not_zip");

  const end = findEndOfCentralDirectory(view);
  if (end === -1) return refuse("not_zip");

  // Multi-part archives died with floppy disks; a number here that is not zero
  // means either one of those or zip64, and both are somebody else's format.
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    return refuse("zip_unsupported", "a multi-part archive");
  }

  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count === MAX_U16 || centralOffset === MAX_U32) return refuse("zip_unsupported", "zip64");
  if (count === 0) return refuse("zip_bad", "no entries");
  if (count > LIMITS.entries) return refuse("zip_too_big", `${count} entries`);

  /** @type {CentralEntry[]} */
  const entries = [];
  let at = centralOffset;
  let totalBytes = 0;

  for (let read = 0; read < count; read += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      return refuse("zip_bad", "central directory does not add up");
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);

    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) return refuse("zip_unsupported", "encrypted");
    if (method !== 0 && method !== 8) return refuse("zip_unsupported", `compression method ${method}`);
    if (compressedSize === MAX_U32 || uncompressedSize === MAX_U32 || localOffset === MAX_U32) {
      return refuse("zip_unsupported", "zip64");
    }
    if (nameLength === 0 || nameLength > LIMITS.nameLength) return refuse("zip_bad", "a nameless or absurd entry");
    if (at + 46 + nameLength > end) return refuse("zip_bad", "central directory does not add up");

    // Names are decoded as UTF-8 whether or not the archive sets the UTF-8
    // flag: WikDict's are plain ASCII, and a mangled name in anything else
    // fails classification later rather than anything here.
    const name = new TextDecoder("utf-8").decode(new Uint8Array(buffer, at + 46, nameLength));
    if (name.includes(String.fromCodePoint(0))) return refuse("zip_bad", "a name with a NUL in it");

    if (!name.endsWith("/")) {
      totalBytes += uncompressedSize;
      if (totalBytes > LIMITS.totalBytes) return refuse("zip_too_big", "unpacks to too much");
      entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  /** @type {ZipEntry[]} */
  const files = [];
  for (const entry of entries) {
    // The local header repeats the name and may carry its own extra field, of
    // a different length than the central one - the data starts after those.
    if (entry.localOffset + 30 > view.byteLength || view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
      return refuse("zip_bad", `${entry.name}: local header is not where the directory says`);
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    if (dataStart + entry.compressedSize > view.byteLength) {
      return refuse("zip_bad", `${entry.name}: data runs past the end of the file`);
    }

    const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize);

    /** @type {Uint8Array} */
    let bytes;
    if (entry.method === 0) {
      bytes = compressed.slice();
    } else {
      try {
        bytes = await inflateRaw(compressed);
      } catch {
        return refuse("zip_bad", `${entry.name}: does not decompress`);
      }
    }

    if (bytes.byteLength !== entry.uncompressedSize) {
      return refuse("zip_bad", `${entry.name}: unpacked to ${bytes.byteLength} bytes, the archive said ${entry.uncompressedSize}`);
    }
    if (crc32(bytes) !== entry.crc) {
      return refuse("zip_bad", `${entry.name}: checksum does not match`);
    }

    files.push({ name: entry.name, bytes });
  }

  if (files.length === 0) return refuse("zip_bad", "only directories inside");
  return { ok: true, value: files };
}

/**
 * @param {ZipProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever pressed Download
 */
export function describeZipProblem(problem, detail) {
  switch (problem) {
    case "not_zip":
      return "What arrived is not a zip archive. Nothing was stored.";
    case "zip_unsupported":
      return `The archive uses a feature this extension does not read${detail === undefined ? "" : ` (${detail})`}. Nothing was stored.`;
    case "zip_too_big":
      return `The archive is larger than a dictionary has any reason to be${detail === undefined ? "" : ` (${detail})`}. Nothing was stored.`;
    case "zip_bad":
      return `The archive is damaged${detail === undefined ? "" : ` (${detail})`}. Nothing was stored - try downloading again.`;
    default:
      return "The archive could not be read. Nothing was stored.";
  }
}
