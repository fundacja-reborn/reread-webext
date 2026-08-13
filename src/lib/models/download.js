/**
 * Fetching a model, and refusing anything that is not the model we asked for.
 *
 * The rule this file exists to keep: bytes off the network are not trusted
 * because of where they came from. Every claim the entry makes about a file -
 * a size, a SHA-256 - is enforced before anything is stored. The packaged
 * registry claims both for every file; an entry read off Mozilla's live index
 * claims only what Mozilla declares (the model file carries a sum, the other
 * two do not), and what nobody claimed is caught by the structural checks
 * here and the engine test-load after - not waved through in silence.
 *
 * Each file is held in memory until it has been checked. Streaming it into
 * storage would be gentler on memory, but WebCrypto has no incremental digest,
 * so a stream that has already been written is a stream that can no longer be
 * vetted. Tens of megabytes at a time is a price worth paying for that order.
 *
 * Nothing here touches the browser API or the database: what it returns is the
 * same shape the settings page already stores by hand from files, which keeps
 * this module something `node --test` can drive with a fake `fetch`.
 */

import { aside, t } from "../i18n.js";
import { isGzip } from "./files.js";

/**
 * @typedef {"network" | "http" | "size" | "checksum" | "unpack" | "cancelled"} DownloadProblem
 */

/**
 * @typedef {object} DownloadProgress
 * @property {number} received bytes off the network so far, over all files
 * @property {number} total what the registry says the whole download is
 */

/**
 * @typedef {object} DownloadOptions
 * @property {(progress: DownloadProgress) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {typeof fetch} [fetch] for tests; the real one by default
 */

/**
 * @typedef {{ ok: true, value: import("./store.js").ModelFiles } | { ok: false, problem: DownloadProblem, detail?: string }} DownloadResult
 */

/**
 * Carries a problem code out of the depths without every layer having to return
 * a result object. It never leaves this module: `downloadModel` turns it back
 * into a value, because the settings page has to render this, and "render an
 * exception" has no good answer.
 */
class Refused extends Error {
  /**
   * @param {DownloadProblem} problem
   * @param {string} [detail]
   */
  constructor(problem, detail) {
    super(detail ?? problem);
    this.name = "Refused";
    /** @type {DownloadProblem} */
    this.problem = problem;
    /** @type {string | undefined} */
    this.detail = detail;
  }
}

/**
 * @param {string} url
 * @returns {string} the last path segment, which is what a reader recognises
 */
function fileName(url) {
  return url.split("?")[0]?.split("/").pop() || url;
}

/**
 * @param {Uint8Array} view
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(view) {
  const { buffer, byteOffset, byteLength } = view;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return /** @type {ArrayBuffer} */ (view.slice().buffer);
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} lower-case hex, as the registry writes it
 */
export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Model files are published gzipped. Whether a particular one is compressed is
 * read off its first two bytes rather than its name, because the name is the
 * one thing a mirror is free to change.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<ArrayBuffer>}
 */
async function unpack(bytes) {
  const buffer = toArrayBuffer(bytes);
  if (!isGzip(buffer)) return buffer;
  try {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  } catch (error) {
    throw new Refused("unpack", error instanceof Error ? error.message : String(error));
  }
}

/**
 * @param {Response} response
 * @param {(chunk: number) => void} onChunk
 * @param {AbortSignal} [signal]
 * @returns {Promise<Uint8Array>}
 */
async function readBody(response, onChunk, signal) {
  const body = response.body;
  if (body === null) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onChunk(whole.byteLength);
    return whole;
  }

  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    onChunk(value.byteLength);
    // Checked here as well as by `fetch` itself: a body that is already in the
    // browser's buffer keeps arriving after an abort, and a reader who pressed
    // cancel means now, not at the end of the file.
    if (signal?.aborted) {
      // The stream may already be torn down by the abort itself; either way,
      // what matters here is the code that comes back, not how it stopped.
      await reader.cancel().catch(() => undefined);
      throw new Refused("cancelled");
    }
  }

  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

/**
 * @param {import("./registry.js").RegistryFile} file
 * @param {typeof fetch} fetchImpl
 * @param {(chunk: number) => void} onChunk
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchFile(file, fetchImpl, onChunk, signal) {
  if (signal?.aborted) throw new Refused("cancelled");

  let response;
  try {
    // `no-store`: these are checked by content, so a stale copy in the HTTP
    // cache would save nothing and could only confuse a retry after a failure.
    response = await fetchImpl(file.url, { signal, cache: "no-store", redirect: "follow" });
  } catch (error) {
    if (signal?.aborted) throw new Refused("cancelled");
    throw new Refused("network", `${fileName(file.url)}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Refused("http", `${response.status} ${response.statusText} for ${fileName(file.url)}`.trim());
  }

  let received;
  try {
    received = await readBody(response, onChunk, signal);
  } catch (error) {
    if (error instanceof Refused) throw error;
    if (signal?.aborted) throw new Refused("cancelled");
    throw new Refused("network", `${fileName(file.url)}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const content = await unpack(received);

  // An empty file is no file, whatever the entry claimed or left unclaimed.
  if (content.byteLength === 0) {
    throw new Refused("size", `${fileName(file.url)}: empty`);
  }
  // Size first: it is free, and "the download stopped early" is a different
  // thing to tell somebody than "this is not the file we expected". Zero means
  // the entry made no claim - there is nothing to hold the file to.
  if (file.bytes > 0 && content.byteLength !== file.bytes) {
    throw new Refused("size", `${fileName(file.url)}: ${content.byteLength} bytes, expected ${file.bytes}`);
  }
  if (file.sha256 !== null && (await sha256Hex(content)) !== file.sha256) {
    throw new Refused("checksum", fileName(file.url));
  }

  return content;
}

/**
 * @param {import("./registry.js").RegistryModel} model
 * @param {DownloadOptions} [options]
 * @returns {Promise<DownloadResult>}
 */
export async function downloadModel(model, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const { onProgress, signal } = options;

  let received = 0;
  /** @param {number} chunk */
  const onChunk = (chunk) => {
    received += chunk;
    // The total comes from the registry, so it is what the download was
    // announced as. If more arrives than that, the announcement was the wrong
    // one - raise it rather than report a bar past its own end.
    onProgress?.({ received, total: Math.max(model.downloadBytes, received) });
  };

  /** @type {ArrayBuffer | null} */
  let modelFile = null;
  /** @type {ArrayBuffer | null} */
  let shortlist = null;
  /** @type {ArrayBuffer[]} */
  const vocabs = [];

  try {
    // One file at a time: three parallel downloads would race for the same
    // bandwidth, make progress meaningless and hold all three in memory at once.
    for (const file of model.files) {
      const content = await fetchFile(file, fetchImpl, onChunk, signal);
      if (file.role === "model") modelFile = content;
      else if (file.role === "shortlist") shortlist = content;
      else vocabs.push(content);
    }
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem, ...(error.detail ? { detail: error.detail } : {}) };
    return { ok: false, problem: "network", detail: error instanceof Error ? error.message : String(error) };
  }

  // The registry is validated to have all three roles, so this can only trip if
  // that validation and this loop ever disagree - and silently storing a model
  // without its shortlist would be a translation that fails much later.
  if (modelFile === null || shortlist === null || vocabs.length === 0) {
    return { ok: false, problem: "size", detail: "the download is missing one of the three files" };
  }

  return { ok: true, value: { pair: model.pair, model: modelFile, shortlist, vocabs } };
}

/**
 * @param {DownloadProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever pressed download
 */
export function describeDownloadProblem(problem, detail) {
  switch (problem) {
    case "network":
      return t("model_download_network", aside(detail));
    case "http":
      return t("model_download_http", aside(detail));
    case "size":
      return t("model_download_size", aside(detail));
    case "checksum":
      return t("model_download_checksum", aside(detail));
    case "unpack":
      return t("model_download_unpack", aside(detail));
    case "cancelled":
      return t("download_cancelled");
    default:
      return t("download_failed");
  }
}
