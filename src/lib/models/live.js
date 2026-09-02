/**
 * The freshest list of models this device has seen, and how it gets fresher.
 *
 * The settings page asks for Mozilla's index when its update button is
 * pressed - never by itself - and keeps the answer in `storage.local`, so the
 * list somebody sees is the list from the last time the network answered -
 * dated, never blank. Asking is cheap on purpose: the ETag from last time
 * rides along, and an unchanged index costs a 304 and no transfer.
 *
 * Failure is survivable by design. No network, a refused request, an index
 * that does not parse - the cached list (or the packaged registry) simply
 * remains what the page shows, dated. The one thing failure must never do is
 * erase a good cache.
 *
 * What is stored is re-checked on the way out (`parseRegistry` plus the host
 * guard), not only on the way in: a cache is bytes on disk, and bytes on disk
 * are data, not gospel - the same posture the packaged registry gets.
 */

import { webext } from "../browser.js";
import { answeredByHost } from "../same-host.js";
import { parseRegistry, registrySource } from "./registry.js";
import { allowedPrefix, convertUpstreamIndex, underPrefix } from "./upstream.js";

/** The one key this module owns in `storage.local`. */
export const LIVE_MODELS_KEY = "modelsIndex";

/**
 * @typedef {object} LiveModels
 * @property {string} fetchedAt `YYYY-MM-DD`, the day the network last answered
 * @property {import("./registry.js").RegistryModel[]} models
 */

/**
 * @param {unknown} stored value under `LIVE_MODELS_KEY`
 * @returns {(LiveModels & { etag: string | null }) | null}
 */
function readStored(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { fetchedAt, etag, models } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) return null;

  // Through the same defensive parse the packaged file gets - lenient about
  // sums, because live entries carry only what Mozilla declares - then through
  // the host guard: a cache written by a future version, or damaged, or
  // somehow tampered with, must not become a way around either.
  const parsed = parseRegistry({ models }, { requireSums: false });
  const prefix = allowedPrefix(registrySource().source);
  const kept = parsed.models.filter((model) => model.files.every((file) => underPrefix(file.url, prefix)));
  if (kept.length === 0) return null;

  return { fetchedAt, etag: typeof etag === "string" ? etag : null, models: kept };
}

/**
 * @returns {Promise<LiveModels | null>} the cached list, or null when there is none worth showing
 */
export async function readLiveModels() {
  try {
    const stored = await webext().storage.local.get(LIVE_MODELS_KEY);
    const read = readStored(stored[LIVE_MODELS_KEY]);
    return read === null ? null : { fetchedAt: read.fetchedAt, models: read.models };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ ok: true, changed: boolean, value: LiveModels } | { ok: false, detail: string }} RefreshResult
 */

/**
 * Asks the index's host what the list is today.
 *
 * @param {{ fetch?: typeof fetch, today?: string }} [options] for tests
 * @returns {Promise<RefreshResult>}
 */
export async function refreshLiveModels(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const { source } = registrySource();
  if (source === "") return { ok: false, detail: "no source in the packaged registry" };

  /** @type {(LiveModels & { etag: string | null }) | null} */
  let cached = null;
  try {
    const stored = await webext().storage.local.get(LIVE_MODELS_KEY);
    cached = readStored(stored[LIVE_MODELS_KEY]);
  } catch {
    // A cache that cannot be read is a cache that will be replaced.
  }

  let response;
  try {
    response = await fetchImpl(source, {
      // The conditional request is the whole economy of this refresh; the
      // browser's own cache underneath it would only blur whose answer this is.
      cache: "no-store",
      // Nothing of the reader's rides along - said rather than defaulted (D171).
      credentials: "omit",
      redirect: "follow",
      ...(cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {}),
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  // The index from its own host or from nobody (D171): an answer redirected
  // elsewhere is not Mozilla's list, whatever it holds.
  if (!answeredByHost(response, source)) return { ok: false, detail: "answered from another host" };

  if (response.status === 304 && cached !== null) {
    // Unchanged upstream. The date still moves: it answers "when did the
    // network last confirm this list", not "when did it last differ".
    const value = { fetchedAt: today, models: cached.models };
    await write({ ...value, etag: cached.etag });
    return { ok: true, changed: false, value };
  }

  if (!response.ok) {
    return { ok: false, detail: `${response.status} ${response.statusText}`.trim() };
  }

  /** @type {unknown} */
  let raw;
  try {
    raw = await response.json();
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  const { models } = convertUpstreamIndex(raw, source);
  // An index that converts to nothing is an answer to distrust, not to show:
  // keeping yesterday's list beats presenting an empty catalogue as news.
  if (models.length === 0) return { ok: false, detail: "the index held no usable models" };

  const value = { fetchedAt: today, models };
  await write({ ...value, etag: response.headers.get("ETag") });
  return { ok: true, changed: true, value };
}

/**
 * @param {LiveModels & { etag: string | null }} value
 */
async function write(value) {
  try {
    await webext().storage.local.set({ [LIVE_MODELS_KEY]: value });
  } catch {
    // A cache that cannot be written costs one refresh next time, nothing more.
  }
}
