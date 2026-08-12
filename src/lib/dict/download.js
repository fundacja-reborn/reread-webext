/**
 * Fetching a dictionary archive from the catalogue.
 *
 * Deliberately not the model downloader. That one holds every file to a
 * SHA-256 pinned in the package, because Mozilla's bucket keeps a model at one
 * address forever. WikDict rebuilds its files in place - a sum pinned at
 * release would fail the day they regenerate, which is to say: work exactly
 * until it is needed. So there is no pinned sum here, and the honesty is in
 * saying so: what stands between a download and the database is the size cap
 * below, the archive's own structure checks (`zip.js`), and the StarDict
 * parser, which treats every file as hostile no matter where it came from -
 * the same parser that guards the files somebody picks by hand.
 *
 * Progress is best-effort: the catalogue carries no sizes (they change with
 * every rebuild upstream), so the total comes from `Content-Length` when the
 * server sends one, and is zero when it does not - the caller shows a bar
 * without an end rather than a bar that lies.
 */

/**
 * @typedef {"network" | "http" | "too_big" | "cancelled"} DictDownloadProblem
 */

/**
 * @typedef {object} DictDownloadProgress
 * @property {number} received bytes so far
 * @property {number} total from Content-Length, or 0 when the server did not say
 */

/**
 * @typedef {object} DictDownloadOptions
 * @property {(progress: DictDownloadProgress) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {typeof fetch} [fetch] for tests; the real one by default
 */

/**
 * @typedef {{ ok: true, value: ArrayBuffer } | { ok: false, problem: DictDownloadProblem, detail?: string }} DictDownloadResult
 */

/**
 * The largest download this will accept, compressed. WikDict's biggest archive
 * is a few megabytes; far above that and this is not the file the catalogue
 * promised, whatever it is.
 */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

/**
 * @param {string} url
 * @returns {string} the last path segment, which is what a reader recognises
 */
function fileName(url) {
  return url.split("?")[0]?.split("/").pop() || url;
}

/**
 * @param {string} url
 * @param {DictDownloadOptions} [options]
 * @returns {Promise<DictDownloadResult>}
 */
export async function downloadArchive(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const { onProgress, signal } = options;

  if (signal?.aborted) return { ok: false, problem: "cancelled" };

  /** @type {Response} */
  let response;
  try {
    // `no-store` for the same reason models use it: these bytes are judged by
    // content, so a stale copy in the HTTP cache could only confuse a retry.
    response = await fetchImpl(url, { signal, cache: "no-store", redirect: "follow" });
  } catch (error) {
    if (signal?.aborted) return { ok: false, problem: "cancelled" };
    return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!response.ok) {
    return { ok: false, problem: "http", detail: `${response.status} ${response.statusText} for ${fileName(url)}`.trim() };
  }

  const claimed = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  const total = Number.isSafeInteger(claimed) && claimed > 0 ? claimed : 0;
  if (total > MAX_ARCHIVE_BYTES) {
    return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${total} bytes` };
  }

  const body = response.body;
  if (body === null) {
    // No stream to meter - an old shim or a test double. The size cap still
    // holds; only the progress is coarser.
    const whole = await response.arrayBuffer();
    if (whole.byteLength > MAX_ARCHIVE_BYTES) {
      return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${whole.byteLength} bytes` };
    }
    onProgress?.({ received: whole.byteLength, total });
    return { ok: true, value: whole };
  }

  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;

  for (;;) {
    /** @type {{ done: boolean, value?: Uint8Array }} */
    let step;
    try {
      step = await reader.read();
    } catch (error) {
      if (signal?.aborted) return { ok: false, problem: "cancelled" };
      return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (step.done) break;
    const chunk = step.value ?? new Uint8Array(0);

    chunks.push(chunk);
    received += chunk.byteLength;
    // The cap is enforced on what actually arrives, not on the header - a
    // header is a claim, and the claim is not what fills memory.
    if (received > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, problem: "too_big", detail: `${fileName(url)}: over ${MAX_ARCHIVE_BYTES} bytes` };
    }
    // A total the server claimed is raised rather than overrun when it turns
    // out to be short; no claim at all stays zero, and the bar stays endless.
    onProgress?.({ received, total: total === 0 ? 0 : Math.max(total, received) });

    // Checked as well as passed to `fetch`: a body already buffered keeps
    // arriving after an abort, and cancel is supposed to mean now.
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, problem: "cancelled" };
    }
  }

  const all = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, value: all.buffer };
}

/**
 * @param {DictDownloadProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever pressed Download
 */
export function describeDictDownloadProblem(problem, detail) {
  switch (problem) {
    case "network":
      return `Could not reach the place dictionaries are kept${detail ? ` (${detail})` : ""}. Nothing was stored.`;
    case "http":
      return `The download was refused${detail ? `: ${detail}` : ""}. The dictionary may have moved; nothing was stored.`;
    case "too_big":
      return `The download is far larger than a dictionary should be${detail ? ` (${detail})` : ""}, so it was stopped. Nothing was stored.`;
    case "cancelled":
      return "Download cancelled. Nothing was stored.";
    default:
      return "The download did not finish, and nothing was stored.";
  }
}
