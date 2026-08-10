/**
 * Making sense of the files a translation model is made of.
 *
 * A Mozilla model for one direction is three files with names that carry
 * everything needed to sort them out:
 *
 *   model.enpl.intgemm.alphas.bin      the model itself
 *   lex.50.50.enpl.s2t.bin             the shortlist
 *   vocab.enpl.spm                     the vocabulary, often shared both ways
 *
 * and any of them may arrive gzipped, because that is how they are published.
 *
 * This module is pure on purpose: picking files apart is the part that can be
 * wrong in a way no smoke test would catch, so it is the part with tests.
 */

/** @typedef {"model" | "shortlist" | "vocab"} Role */

/**
 * @typedef {object} ClassifiedFiles
 * @property {string} pair language pair as stored, e.g. "enpl"
 * @property {string} from
 * @property {string} to
 * @property {Record<Role, string[]>} byRole file names, in the order given
 */

/**
 * @typedef {"empty" | "unknown_file" | "unknown_pair" | "mixed_pairs" | "missing_model" | "missing_shortlist" | "missing_vocab"} ClassifyProblem
 */

/**
 * Gzip announces itself in its first two bytes. Cheaper and more honest than
 * trusting a file extension somebody may have stripped.
 *
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {boolean}
 */
export function isGzip(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * @param {string} name
 * @returns {string} the name with a trailing `.gz` removed
 */
function withoutGz(name) {
  return name.replace(/\.gz$/i, "");
}

/**
 * @param {string} name
 * @returns {Role | null}
 */
function roleOf(name) {
  const base = withoutGz(name).toLowerCase();
  if (base.startsWith("model.")) return "model";
  if (base.startsWith("lex.")) return "shortlist";
  if (base.startsWith("vocab.")) return "vocab";
  return null;
}

/**
 * The language pair lives in one dot-separated segment of four letters -
 * `enpl`, `plen` - and nothing else in these names looks like that.
 *
 * @param {string} name
 * @returns {{ pair: string, from: string, to: string } | null}
 */
export function parsePair(name) {
  for (const segment of withoutGz(name).toLowerCase().split(".")) {
    if (/^[a-z]{4}$/.test(segment)) {
      return { pair: segment, from: segment.slice(0, 2), to: segment.slice(2) };
    }
  }
  return null;
}

/**
 * Sorts a set of file names into the three roles of one language pair.
 *
 * @param {string[]} names
 * @returns {{ ok: true, value: ClassifiedFiles } | { ok: false, problem: ClassifyProblem, detail?: string }}
 */
export function classifyModelFiles(names) {
  if (names.length === 0) return { ok: false, problem: "empty" };

  /** @type {Record<Role, string[]>} */
  const byRole = { model: [], shortlist: [], vocab: [] };
  /** @type {Map<string, { from: string, to: string }>} */
  const pairs = new Map();

  for (const name of names) {
    const role = roleOf(name);
    if (role === null) return { ok: false, problem: "unknown_file", detail: name };

    const parsed = parsePair(name);
    if (parsed === null) return { ok: false, problem: "unknown_pair", detail: name };

    byRole[role].push(name);
    pairs.set(parsed.pair, { from: parsed.from, to: parsed.to });
  }

  if (pairs.size > 1) {
    return { ok: false, problem: "mixed_pairs", detail: [...pairs.keys()].sort().join(", ") };
  }

  if (byRole.model.length === 0) return { ok: false, problem: "missing_model" };
  if (byRole.shortlist.length === 0) return { ok: false, problem: "missing_shortlist" };
  if (byRole.vocab.length === 0) return { ok: false, problem: "missing_vocab" };

  const [pair] = [...pairs.keys()];
  const languages = pairs.get(/** @type {string} */ (pair));
  if (pair === undefined || languages === undefined) return { ok: false, problem: "unknown_pair" };

  return { ok: true, value: { pair, from: languages.from, to: languages.to, byRole } };
}

/**
 * @param {ClassifyProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever picked the files
 */
export function describeClassifyProblem(problem, detail) {
  switch (problem) {
    case "empty":
      return "No files were selected.";
    case "unknown_file":
      return `Not part of a model: ${detail ?? "one of the files"}. Expected names starting with model., lex. and vocab.`;
    case "unknown_pair":
      return `Cannot tell which languages this file is for: ${detail ?? "one of the files"}.`;
    case "mixed_pairs":
      return `Those files are for more than one language pair (${detail ?? ""}). Load one direction at a time.`;
    case "missing_model":
      return "The model file is missing (model.<pair>.intgemm.alphas.bin).";
    case "missing_shortlist":
      return "The shortlist file is missing (lex.<pair>.s2t.bin).";
    case "missing_vocab":
      return "The vocabulary file is missing (vocab.<pair>.spm).";
    default:
      return "Those files are not a translation model.";
  }
}
