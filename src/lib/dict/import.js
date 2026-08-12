/**
 * Taking the files somebody picked and answering with a dictionary.
 *
 * Once, at import, and never again: the .dict file is read from end to end
 * here, and what goes into the database is the result. Nothing reads a
 * dictionary file while somebody is reading a page - which is the whole reason
 * `.dict.dz` never has to be understood as dictzip. A dictzip file is a valid
 * gzip file with a random-access table in its header, and a reader that only
 * ever wants all of it can let the table go by.
 *
 * Archives arrive here already opened. The catalogue downloads WikDict's
 * `.zip` files and `zip.js` takes them apart; somebody adding files by hand
 * unpacks the archive themselves. Either way, what this module sees is a set
 * of named files - `dictionaryFromZip` below is the whole of the difference,
 * and the two paths share every check after it.
 *
 * Nothing in this module touches the browser or the database, so `node --test`
 * drives every path through it, including the ones a smoke test could never
 * reach: a truncated index, an entry pointing past the end of the file, a
 * dictionary that turns out to be something else entirely.
 */

import { isGzip } from "../models/files.js";
import { parseIdx, parseIfo, parseSyn, readFields } from "./stardict.js";
import { LIMITS, about, senses } from "./text.js";

/**
 * @typedef {"empty" | "missing_ifo" | "missing_idx" | "missing_dict" | "mixed" | "not_stardict" | "unpack" | "no_entries"} ImportProblem
 */

/**
 * @typedef {object} DictionaryFileNames
 * @property {string} base the name all four files share
 * @property {string} ifo
 * @property {string} idx
 * @property {string} dict
 * @property {string} [syn]
 */

/**
 * @typedef {object} DictionaryBytes
 * @property {ArrayBuffer | Uint8Array} ifo
 * @property {ArrayBuffer | Uint8Array} idx
 * @property {ArrayBuffer | Uint8Array} dict
 * @property {ArrayBuffer | Uint8Array} [syn]
 */

/**
 * @typedef {object} ParsedEntry
 * @property {string} headword as the dictionary spells it
 * @property {string[]} senses plain text
 */

/**
 * @typedef {object} ParsedDictionary
 * @property {string} name
 * @property {string | null} credit
 * @property {ParsedEntry[]} entries in the order the file has them
 * @property {{ headword: string, target: number }[]} aliases `target` indexes into `entries`
 * @property {number} skipped entries whose data could not be read
 */

/**
 * @typedef {{ ok: true, value: ParsedDictionary } | { ok: false, problem: ImportProblem, detail?: string }} ImportResult
 */

/** How often the parse stops to let a page repaint, in entries. */
const YIELD_EVERY = 20000;

/**
 * @param {string} name
 * @returns {string} without the compression suffix a StarDict file may carry
 */
function withoutCompression(name) {
  return name.replace(/\.(?:gz|dz)$/iu, "");
}

/**
 * Sorts the files of one dictionary out by their extension.
 *
 * Unknown files are ignored rather than refused. A StarDict folder holds more
 * than the four files that matter - offset caches, a resource folder, a readme -
 * and somebody who selects all of them has done nothing wrong.
 *
 * @param {string[]} names
 * @returns {{ ok: true, value: DictionaryFileNames } | { ok: false, problem: ImportProblem, detail?: string }}
 */
export function classifyDictionaryFiles(names) {
  if (names.length === 0) return { ok: false, problem: "empty" };

  /** @type {Map<string, Partial<Record<"ifo" | "idx" | "dict" | "syn", string>>>} */
  const byBase = new Map();

  for (const name of names) {
    const bare = withoutCompression(name);
    const match = /^(.*)\.(ifo|idx|dict|syn)$/iu.exec(bare);
    if (match === null) continue;

    const base = match[1] ?? "";
    const role = /** @type {"ifo" | "idx" | "dict" | "syn"} */ ((match[2] ?? "").toLowerCase());
    const found = byBase.get(base) ?? {};
    // First one wins, so a folder holding both `x.idx` and `x.idx.gz` picks one
    // instead of reading the same index twice.
    if (found[role] === undefined) found[role] = name;
    byBase.set(base, found);
  }

  if (byBase.size === 0) return { ok: false, problem: "missing_ifo" };
  if (byBase.size > 1) {
    return { ok: false, problem: "mixed", detail: [...byBase.keys()].sort().join(", ") };
  }

  const [base] = [...byBase.keys()];
  const files = byBase.get(/** @type {string} */ (base)) ?? {};

  if (files.ifo === undefined) return { ok: false, problem: "missing_ifo" };
  if (files.idx === undefined) return { ok: false, problem: "missing_idx" };
  if (files.dict === undefined) return { ok: false, problem: "missing_dict" };

  return {
    ok: true,
    value: {
      base: /** @type {string} */ (base),
      ifo: files.ifo,
      idx: files.idx,
      dict: files.dict,
      ...(files.syn === undefined ? {} : { syn: files.syn }),
    },
  };
}

/**
 * Sorts the files inside a downloaded archive into the roles of one
 * dictionary, and hands their bytes over.
 *
 * The junk a zip really carries is dropped before classification: resource
 * forks and folder metadata (`__MACOSX`, names starting with a dot) would
 * otherwise read as a second dictionary and fail the one-at-a-time rule for
 * something nobody chose to put there. Real files keep their full archive
 * paths, so two dictionaries genuinely zipped together still refuse cleanly.
 *
 * @param {import("./zip.js").ZipEntry[]} entries
 * @returns {{ ok: true, value: { base: string, files: DictionaryBytes } } | { ok: false, problem: ImportProblem, detail?: string }}
 */
export function dictionaryFromZip(entries) {
  const usable = entries.filter((entry) => {
    const leaf = entry.name.split("/").pop() ?? "";
    return leaf.length > 0 && !leaf.startsWith(".") && !entry.name.split("/").includes("__MACOSX");
  });

  const classified = classifyDictionaryFiles(usable.map((entry) => entry.name));
  if (!classified.ok) return classified;
  const { base, ifo, idx, dict, syn } = classified.value;

  /** @param {string} name */
  const bytesOf = (name) => /** @type {Uint8Array} */ (usable.find((entry) => entry.name === name)?.bytes);

  return {
    ok: true,
    value: {
      // The base may still carry the folder the archive wraps its files in;
      // the leaf is what a status line should call the dictionary.
      base: base.split("/").pop() || base,
      files: {
        ifo: bytesOf(ifo),
        idx: bytesOf(idx),
        dict: bytesOf(dict),
        ...(syn === undefined ? {} : { syn: bytesOf(syn) }),
      },
    },
  };
}

/**
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {ArrayBuffer} without copying, when the view is the whole buffer
 */
function bufferOf(data) {
  if (data instanceof ArrayBuffer) return data;
  const { buffer, byteOffset, byteLength } = data;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return data.slice().buffer;
}

/**
 * A `.dict.dz` is a gzip file with a table in its header for reading pieces of
 * it without decompressing the rest. We want all of it, once, so the table goes
 * by as a header nobody reads and the browser's own gzip does the work.
 *
 * Compression is read off the first two bytes rather than the extension: `.dz`,
 * `.gz` and a plain `.dict` that happens to be compressed all arrive, and the
 * name is the one thing a person renaming files is free to change.
 *
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function unpack(data) {
  const buffer = bufferOf(data);
  if (!isGzip(buffer)) return new Uint8Array(buffer);

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @returns {Promise<void>} a turn of the event loop, so a page can repaint
 */
function breathe() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {DictionaryBytes} files
 * @param {object} [options]
 * @param {string} [options.fallbackName] when the .ifo does not name the dictionary
 * @param {(progress: { done: number, total: number }) => void} [options.onProgress]
 * @returns {Promise<ImportResult>}
 */
export async function readDictionary(files, { fallbackName, onProgress } = {}) {
  /** @type {{ ifo: Uint8Array, idx: Uint8Array, dict: Uint8Array, syn?: Uint8Array }} */
  let unpacked;
  try {
    const [ifo, idx, dict] = await Promise.all([unpack(files.ifo), unpack(files.idx), unpack(files.dict)]);
    unpacked = { ifo, idx, dict, ...(files.syn === undefined ? {} : { syn: await unpack(files.syn) }) };
  } catch (error) {
    return { ok: false, problem: "unpack", detail: error instanceof Error ? error.message : String(error) };
  }

  const ifo = parseIfo(new TextDecoder("utf-8").decode(unpacked.ifo), fallbackName);
  if (!ifo.ok) return ifo;

  const { entries: index } = parseIdx(unpacked.idx, ifo.value.offsetBits);

  /** @type {ParsedEntry[]} */
  const entries = [];
  /**
   * Where each index position ended up, for the synonym file to follow. Entries
   * that could not be read are dropped, so a position in the index and a
   * position in the list above stop being the same number at the first bad one -
   * and this is what keeps `went` pointing at `go` rather than at whatever
   * moved into its place.
   *
   * @type {Map<number, number>}
   */
  const moved = new Map();
  let skipped = 0;

  for (const [position, entry] of index.entries()) {
    const fields = readFields(unpacked.dict, entry, ifo.value.sametypesequence);
    if (fields === null) {
      skipped += 1;
    } else {
      const meanings = senses(fields);
      if (meanings.length === 0) {
        skipped += 1;
      } else {
        moved.set(position, entries.length);
        entries.push({ headword: entry.word, senses: meanings });
      }
    }

    if ((position + 1) % YIELD_EVERY === 0) {
      onProgress?.({ done: position + 1, total: index.length });
      await breathe();
    }
  }

  onProgress?.({ done: index.length, total: index.length });

  if (entries.length === 0) {
    return { ok: false, problem: "no_entries", detail: index.length === 0 ? undefined : `${skipped}` };
  }

  /** @type {{ headword: string, target: number }[]} */
  const aliases = [];
  for (const synonym of unpacked.syn === undefined ? [] : parseSyn(unpacked.syn)) {
    const target = moved.get(synonym.target);
    if (target !== undefined) aliases.push({ headword: synonym.word, target });
  }

  // The .ifo file describes the book in the same HTML its entries are written
  // in, so it gets the same treatment (D29): what a settings page prints must
  // be text by the time it is stored, not markup waiting to be dealt with.
  const name = about(ifo.value.bookname, LIMITS.name) ?? fallbackName ?? "Dictionary";

  return {
    ok: true,
    value: { name, credit: about(ifo.value.credit), entries, aliases, skipped },
  };
}

/**
 * @param {ImportProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever picked the files, always ending in
 *   what happened to their data - which is nothing
 */
export function describeImportProblem(problem, detail) {
  switch (problem) {
    case "empty":
      return "No files were selected. Nothing was stored.";
    case "missing_ifo":
      return "There is no .ifo file among those, so this is not a StarDict dictionary. Nothing was stored.";
    case "missing_idx":
      return "The index is missing (.idx or .idx.gz). Nothing was stored.";
    case "missing_dict":
      return "The dictionary body is missing (.dict or .dict.dz). Nothing was stored.";
    case "mixed":
      return `Those files belong to more than one dictionary (${detail ?? ""}). Add one at a time. Nothing was stored.`;
    case "not_stardict":
      return detail === undefined
        ? "That .ifo file is not a StarDict dictionary. Nothing was stored."
        : `That is ${detail}, which this extension cannot read. Nothing was stored.`;
    case "unpack":
      return `The files are compressed in a way that could not be unpacked${detail === undefined ? "" : ` (${detail})`}. Nothing was stored.`;
    case "no_entries":
      return detail === undefined
        ? "The index is empty - there are no words in this dictionary. Nothing was stored."
        : `Not one of the ${detail} words in the index could be read, so the files do not belong together. Nothing was stored.`;
    default:
      return "Those files are not a dictionary this extension can read. Nothing was stored.";
  }
}
