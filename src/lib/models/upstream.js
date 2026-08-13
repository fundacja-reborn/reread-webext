/**
 * Reading Mozilla's own index of published models (`models.json`), defensively.
 *
 * The index is data from the network, so nothing in it is taken at its word:
 * every address must sit under the host and bucket the packaged registry names
 * (`allowedPrefix`), every entry must have the three files the engine loads,
 * and an entry that fails any of it is dropped and reported rather than
 * allowed to take the rest of the list down. This is the same posture
 * `registry.js` takes towards the packaged file - only the source differs.
 *
 * Where the index states what an unpacked file should be (a SHA-256 and a
 * size - it does, for the model file), those ride along and the download layer
 * enforces them. Where it states nothing, the download layer's structural
 * checks and the engine test-load are the gate.
 *
 * Pure on purpose: `tools/models-registry.mjs` picks entries by the same rules
 * when it writes the packaged registry, and the rule both share must live in
 * one place `node --test` can reach.
 */

/**
 * When a pair has more than one released build, this is the order they are
 * preferred in. The memory variant first, because it is the one Mozilla builds
 * for the bergamot core on constrained runtimes - and our engine is that same
 * core compiled to WebAssembly, running with a fixed 128 MB workspace.
 */
export const ARCHITECTURE_PREFERENCE = ["base-memory", "tiny", "base"];

/**
 * Upstream file keys mapped to the roles the engine loads. A pair publishes
 * either one shared vocabulary or one per side; both shapes appear in the
 * index, so both are handled rather than assumed away.
 */
export const UPSTREAM_ROLES = Object.freeze({
  model: "model",
  lexicalShortlist: "shortlist",
  vocab: "vocab",
  srcVocab: "vocab",
  trgVocab: "vocab",
});

const ROLE_ORDER = ["model", "shortlist", "vocab"];

/**
 * The corner of the world addresses are allowed to point into: the origin and
 * bucket of the packaged registry's own source. Everything else about the live
 * index may be fresh, but where bytes come from is decided by the package.
 *
 * @param {string} source the packaged registry's `source` URL
 * @returns {string} e.g. `https://storage.googleapis.com/moz-fx-.../`
 */
export function allowedPrefix(source) {
  const url = new URL(source);
  const bucket = url.pathname.split("/").filter(Boolean)[0] ?? "";
  return `${url.origin}/${bucket}/`;
}

/**
 * @param {string} url
 * @param {string} prefix from `allowedPrefix`
 * @returns {boolean}
 */
export function underPrefix(url, prefix) {
  if (!url.startsWith(prefix)) return false;
  // A prefix check alone would pass `https://host/bucket/../elsewhere`; a URL
  // that still starts with the prefix after the browser's own normalisation
  // cannot be pointing anywhere else.
  try {
    return new URL(url).href.startsWith(prefix);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} entries one pair's entries from the index
 * @returns {{ ok: true, value: any } | { ok: false, problem: string }}
 */
export function pickEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false, problem: "no entries" };

  const released = entries.filter((entry) => String(entry?.releaseStatus ?? "").startsWith("Release"));
  if (released.length === 0) return { ok: false, problem: "nothing released" };

  const rank = (/** @type {any} */ entry) => {
    const at = ARCHITECTURE_PREFERENCE.indexOf(String(entry?.architecture ?? ""));
    return at === -1 ? ARCHITECTURE_PREFERENCE.length : at;
  };
  const sorted = [...released].sort((a, b) => rank(a) - rank(b));

  const [first, second] = sorted;
  // Two released builds of the same architecture would be a choice with no
  // rule for it - refusing the pair beats guessing which bytes to offer.
  if (second !== undefined && rank(first) === rank(second)) {
    return { ok: false, problem: "more than one released build of the same kind" };
  }
  return { ok: true, value: first };
}

/**
 * @param {string} pairKey e.g. `"en-pl"` or `"en-zh_hant"`
 * @returns {{ pair: string, from: string, to: string } | null}
 */
function parsePairKey(pairKey) {
  const parts = pairKey.split("-");
  if (parts.length !== 2) return null;
  const [from, to] = /** @type {[string, string]} */ (parts);
  const code = /^[a-z]{2,3}(_[a-z]{4})?$/;
  if (!code.test(from) || !code.test(to)) return null;
  return { pair: `${from}${to}`, from, to };
}

/**
 * One entry's files, checked and mapped to roles.
 *
 * @param {any} entry
 * @param {string} baseUrl without a trailing slash
 * @param {string} prefix from `allowedPrefix`
 * @returns {{ ok: true, value: import("./registry.js").RegistryFile[] } | { ok: false, problem: string }}
 */
function convertFiles(entry, baseUrl, prefix) {
  /** @type {import("./registry.js").RegistryFile[]} */
  const files = [];

  for (const [key, published] of Object.entries(entry?.files ?? {})) {
    const role = /** @type {Record<string, "model" | "shortlist" | "vocab">} */ (UPSTREAM_ROLES)[key];
    if (role === undefined) return { ok: false, problem: `unknown file "${key}"` };

    const path = /** @type {any} */ (published)?.path;
    if (typeof path !== "string" || path.length === 0) return { ok: false, problem: `"${key}" has no path` };

    const url = `${baseUrl}/${path}`;
    if (!underPrefix(url, prefix)) return { ok: false, problem: `"${key}" points outside ${prefix}` };

    const claimedHash = /** @type {any} */ (published)?.uncompressedHash;
    const claimedSize = /** @type {any} */ (published)?.uncompressedSize;

    files.push({
      role,
      url,
      // The index does not say what crosses the wire, only what unpacks out of
      // it - zero means unknown, and the download layer treats it as such.
      downloadBytes: 0,
      bytes: typeof claimedSize === "number" && Number.isSafeInteger(claimedSize) && claimedSize > 0 ? claimedSize : 0,
      sha256: typeof claimedHash === "string" && /^[0-9a-f]{64}$/.test(claimedHash) ? claimedHash : null,
    });
  }

  for (const role of ROLE_ORDER) {
    if (!files.some((file) => file.role === role)) return { ok: false, problem: `no ${role} file` };
  }
  if (files.filter((file) => file.role === "model").length > 1) {
    return { ok: false, problem: "more than one model file" };
  }

  files.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.url.localeCompare(b.url));
  return { ok: true, value: files };
}

/**
 * The live index turned into the same shape the packaged registry parses to.
 *
 * @param {unknown} raw parsed `models.json`
 * @param {string} source the packaged registry's `source` URL - the guard
 * @returns {{ models: import("./registry.js").RegistryModel[], problems: string[] }}
 */
export function convertUpstreamIndex(raw, source) {
  /** @type {import("./registry.js").RegistryModel[]} */
  const models = [];
  /** @type {string[]} */
  const problems = [];

  if (typeof raw !== "object" || raw === null) return { models, problems: ["index is not an object"] };

  const { baseUrl, models: byPair } = /** @type {Record<string, unknown>} */ (raw);
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    return { models, problems: ["index has no baseUrl"] };
  }
  const prefix = allowedPrefix(source);
  const base = baseUrl.replace(/\/$/, "");

  if (typeof byPair !== "object" || byPair === null) return { models, problems: ["index has no models"] };

  for (const [pairKey, entries] of Object.entries(byPair)) {
    const languages = parsePairKey(pairKey);
    if (languages === null) {
      problems.push(`${pairKey}: not a language pair`);
      continue;
    }

    const picked = pickEntry(entries);
    if (!picked.ok) {
      problems.push(`${pairKey}: ${picked.problem}`);
      continue;
    }

    const files = convertFiles(picked.value, base, prefix);
    if (!files.ok) {
      problems.push(`${pairKey}: ${files.problem}`);
      continue;
    }

    models.push({
      pair: languages.pair,
      from: languages.from,
      to: languages.to,
      downloadBytes: files.value.reduce((total, file) => total + file.downloadBytes, 0),
      bytes: files.value.reduce((total, file) => total + file.bytes, 0),
      files: files.value,
    });
  }

  models.sort((a, b) => a.pair.localeCompare(b.pair));
  return { models, problems };
}

/**
 * The address a model on this device was built from, for telling whether the
 * list now names a different training run. The model file's URL carries the
 * run in its path, so it is the whole identity - no version field needed.
 *
 * @param {import("./registry.js").RegistryModel} model
 * @returns {string | null}
 */
export function modelSourceUrl(model) {
  return model.files.find((file) => file.role === "model")?.url ?? null;
}

/**
 * Whether the list offers different bytes than the ones a device holds.
 *
 * Answers nothing (false) when the installed model never recorded a source -
 * added from files, or downloaded before sources were recorded: a claim about
 * its version would be a guess.
 *
 * @param {{ sourceUrl?: string } | null} installed
 * @param {import("./registry.js").RegistryModel | null} available
 * @returns {boolean}
 */
export function updateAvailable(installed, available) {
  if (installed === null || available === null) return false;
  const recorded = installed.sourceUrl;
  if (recorded === undefined || recorded === "") return false;
  const offered = modelSourceUrl(available);
  return offered !== null && offered !== recorded;
}
