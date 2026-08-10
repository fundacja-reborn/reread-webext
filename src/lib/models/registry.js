/**
 * The list of models this extension is willing to download, and the checksums
 * it holds them to.
 *
 * The list is a file in the package (`registry.json`), not something fetched at
 * runtime, and that is the point: the addresses and the sums are part of what
 * somebody installed and can read, so the host of the day supplies bytes and
 * nothing else. When Mozilla's bucket disappears - one home for these models
 * has been archived already - the repair is that one file, not this code.
 *
 * `registry.json` is written by `tools/models-registry.mjs`, which downloads
 * every file once and computes the sums itself. Upstream publishes a checksum
 * for one file out of three, and only of its unpacked contents, which is why
 * this cannot be Subresource Integrity and why the sums here are ours.
 *
 * Parsing is defensive for one reason: this file is data, data gets hand-edited
 * on the day a host moves, and a typo in one pair must not take the other pairs
 * down with it. A bad entry is dropped and reported; the gate has a test that
 * the shipped file drops nothing.
 */

import registryData from "./registry.json" with { type: "json" };

/**
 * @typedef {import("./files.js").Role} Role
 */

/**
 * @typedef {object} RegistryFile
 * @property {Role} role
 * @property {string} url
 * @property {number} downloadBytes what crosses the network, gzipped as published
 * @property {number} bytes what is stored, after unpacking - and what `sha256` is of
 * @property {string} sha256 lower-case hex, of the unpacked content
 */

/**
 * @typedef {object} RegistryModel
 * @property {string} pair `"enpl"`, the key models are stored under
 * @property {string} from
 * @property {string} to
 * @property {number} downloadBytes sum over the files
 * @property {number} bytes sum over the files
 * @property {RegistryFile[]} files model first, then shortlist, then vocabularies
 */

const ROLE_ORDER = /** @type {Role[]} */ (["model", "shortlist", "vocab"]);

/** Lower-case hex, 32 bytes. Anything else is not a SHA-256 and never matches. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isSize(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {unknown} raw
 * @param {string} where
 * @returns {{ ok: true, value: RegistryFile } | { ok: false, problem: string }}
 */
function parseFile(raw, where) {
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
  const { role, url, downloadBytes, bytes, sha256 } = /** @type {Record<string, unknown>} */ (raw);

  if (typeof role !== "string" || !(/** @type {string[]} */ (ROLE_ORDER).includes(role))) {
    return { ok: false, problem: `${where}: unknown role ${JSON.stringify(role)}` };
  }
  // Plain http would make the checksum the only thing standing between a reader
  // and whoever is on the wire. The sum would still catch it, but there is no
  // reason to accept the address in the first place.
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return { ok: false, problem: `${where}: url is not https` };
  }
  if (!isSize(downloadBytes) || !isSize(bytes)) {
    return { ok: false, problem: `${where}: sizes must be positive whole numbers` };
  }
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    return { ok: false, problem: `${where}: sha256 is not 64 hex characters` };
  }

  return { ok: true, value: { role: /** @type {Role} */ (role), url, downloadBytes, bytes, sha256 } };
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ ok: true, value: RegistryModel } | { ok: false, problem: string }}
 */
function parseModel(raw, index) {
  const where = `model ${index}`;
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
  const { pair, from, to, files } = /** @type {Record<string, unknown>} */ (raw);

  if (typeof from !== "string" || typeof to !== "string" || !/^[a-z]{2}$/.test(from) || !/^[a-z]{2}$/.test(to)) {
    return { ok: false, problem: `${where}: from and to must be two-letter codes` };
  }
  // The pair is the database key, so it is not allowed to be a second opinion
  // about which languages this is: it has to be the two codes, joined.
  if (pair !== `${from}${to}`) {
    return { ok: false, problem: `${where}: pair ${JSON.stringify(pair)} does not match ${from} and ${to}` };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, problem: `${where}: no files` };
  }

  /** @type {RegistryFile[]} */
  const parsed = [];
  for (const [fileIndex, file] of files.entries()) {
    const result = parseFile(file, `${where}, file ${fileIndex}`);
    if (!result.ok) return result;
    parsed.push(result.value);
  }

  for (const role of ROLE_ORDER) {
    if (!parsed.some((file) => file.role === role)) {
      return { ok: false, problem: `${where}: no ${role} file` };
    }
  }
  if (parsed.filter((file) => file.role === "model").length > 1) {
    return { ok: false, problem: `${where}: more than one model file` };
  }

  parsed.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  // The totals in the file are there for whoever opens it; the ones used here
  // are added up from the parts, so a stale total cannot understate what a
  // download is about to cost.
  return {
    ok: true,
    value: {
      pair,
      from,
      to,
      downloadBytes: parsed.reduce((total, file) => total + file.downloadBytes, 0),
      bytes: parsed.reduce((total, file) => total + file.bytes, 0),
      files: parsed,
    },
  };
}

/**
 * @param {unknown} raw
 * @returns {{ models: RegistryModel[], problems: string[] }}
 */
export function parseRegistry(raw) {
  if (typeof raw !== "object" || raw === null) return { models: [], problems: ["registry is not an object"] };

  const list = /** @type {Record<string, unknown>} */ (raw)["models"];
  if (!Array.isArray(list)) return { models: [], problems: ["registry has no models array"] };

  /** @type {RegistryModel[]} */
  const models = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const [index, entry] of list.entries()) {
    const result = parseModel(entry, index);
    if (!result.ok) {
      problems.push(result.problem);
      continue;
    }
    if (seen.has(result.value.pair)) {
      problems.push(`model ${index}: ${result.value.pair} is listed twice`);
      continue;
    }
    seen.add(result.value.pair);
    models.push(result.value);
  }

  models.sort((a, b) => a.pair.localeCompare(b.pair));
  return { models, problems };
}

/** @type {{ models: RegistryModel[], problems: string[] } | null} */
let parsed = null;

/**
 * @returns {{ models: RegistryModel[], problems: string[] }}
 */
function registry() {
  parsed ??= parseRegistry(registryData);
  return parsed;
}

/**
 * @returns {RegistryModel[]} every model that can be downloaded, by pair
 */
export function registryModels() {
  return registry().models;
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {RegistryModel | null}
 */
export function findRegistryModel(from, to) {
  return registry().models.find((model) => model.from === from && model.to === to) ?? null;
}

/**
 * @typedef {object} ModelRow
 * @property {string} pair
 * @property {string} from
 * @property {string} to
 * @property {import("./store.js").ModelMeta | null} installed what is on this device
 * @property {RegistryModel | null} available what could be downloaded
 */

/**
 * One row per language pair, whether it is here, downloadable, or both.
 *
 * A model added by hand from files is not in the registry and must still be
 * listed - it is the way out on the day the download host stops answering, and
 * a settings page that showed only what it knows how to fetch would hide the
 * thing somebody just installed.
 *
 * @param {import("./store.js").ModelMeta[]} installed
 * @param {RegistryModel[]} [available]
 * @returns {ModelRow[]}
 */
export function modelRows(installed, available = registryModels()) {
  /** @type {Map<string, ModelRow>} */
  const rows = new Map();

  for (const model of available) {
    rows.set(model.pair, { pair: model.pair, from: model.from, to: model.to, installed: null, available: model });
  }

  for (const meta of installed) {
    const row = rows.get(meta.pair);
    if (row === undefined) {
      rows.set(meta.pair, { pair: meta.pair, from: meta.from, to: meta.to, installed: meta, available: null });
    } else {
      row.installed = meta;
    }
  }

  return [...rows.values()].sort((a, b) => a.pair.localeCompare(b.pair));
}

/**
 * Where the addresses came from, so the settings page can say it rather than
 * leave a reader to guess who is about to be contacted.
 *
 * @returns {{ source: string, checkedAt: string }}
 */
export function registrySource() {
  const { source, checkedAt } = /** @type {Record<string, unknown>} */ (registryData);
  return {
    source: typeof source === "string" ? source : "",
    checkedAt: typeof checkedAt === "string" ? checkedAt : "",
  };
}
