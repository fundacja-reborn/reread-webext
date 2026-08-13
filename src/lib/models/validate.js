/**
 * The last rung of the download ladder: does the engine actually stand up
 * with these files?
 *
 * Sizes, gzip and checksums say the bytes arrived whole; only the engine can
 * say they are a model. So before anything is stored, the files are handed to
 * a fresh copy of the same worker the background translates with, told to
 * load them, and thrown away - the worker, not the files. A model the engine
 * refuses is a model nobody gets to keep.
 *
 * The worker is spawned here, on the settings page, rather than asked of the
 * background: the background's engine is live state (a translation may be in
 * flight, a loaded model must stay loaded), and megabytes do not belong in
 * `runtime.sendMessage`. An extension page may spawn the worker directly -
 * same script, same origin - and terminate it the moment it has answered.
 *
 * The buffers are cloned to the worker, not transferred: they are about to be
 * stored, and a transferred buffer is a buffer this side no longer has. The
 * transient copy is the price of "nothing is stored until the engine says
 * yes", and it lives for seconds.
 */

import { webext } from "../browser.js";

const WORKER_PATH = "background/engine.worker.js";

/**
 * Engine start plus one model load, with headroom for a slow phone. A worker
 * that answers nothing for this long is not about to answer, and an endless
 * "checking..." is worse than a clean refusal.
 */
const VERDICT_TIMEOUT_MS = 120_000;

/**
 * @typedef {{ ok: true } | { ok: false, detail: string }} LoadVerdict
 */

/**
 * @param {{ from: string, to: string }} pair
 * @param {import("./store.js").ModelFiles} files
 * @returns {Promise<LoadVerdict>}
 */
export function testLoadModel(pair, files) {
  /** @type {Worker} */
  let worker;
  try {
    worker = new Worker(webext().runtime.getURL(WORKER_PATH));
  } catch (error) {
    // No worker means nothing was checked - not that the model is bad. Waving
    // it through here would turn a broken page into unverified stores.
    return Promise.resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  return new Promise((resolve) => {
    /** @param {LoadVerdict} verdict */
    const settle = (verdict) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(verdict);
    };

    const timer = setTimeout(() => settle({ ok: false, detail: "the engine did not answer" }), VERDICT_TIMEOUT_MS);

    worker.addEventListener("message", (event) => {
      const { id, error } = /** @type {{ id?: unknown, error?: { message?: string } }} */ (event.data ?? {});
      if (id !== 1) return;
      if (error) settle({ ok: false, detail: String(error.message ?? "engine failed") });
      else settle({ ok: true });
    });

    // A model that crashes the engine outright surfaces here, not as a reply.
    worker.addEventListener("error", (event) => {
      settle({ ok: false, detail: String(event.message ?? "the engine crashed") });
    });

    worker.postMessage({
      id: 1,
      name: "load",
      args: [
        { from: pair.from, to: pair.to },
        { model: files.model, shortlist: files.shortlist, vocabs: files.vocabs, config: files.config ?? {} },
      ],
    });
  });
}
