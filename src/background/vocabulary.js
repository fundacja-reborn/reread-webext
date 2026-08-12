/**
 * The background's half of the vocabulary: the database, and the copy pages
 * are allowed to read.
 *
 * Every write here is two steps - the row, then the mirror - and they are in
 * this module rather than in the router so that no future caller can do the
 * first without the second. The mirror is rebuilt in full from what the
 * database just said; a cache that patched itself would be a second version of
 * the truth, and this one is not allowed to have opinions.
 *
 * Nothing here catches: the message router turns an exception into `internal`,
 * and a database that cannot be opened is exactly that.
 */

import { normalize } from "../lib/normalize.js";
import { readConfig } from "../lib/config.js";
import { ok } from "../lib/protocol.js";
import { mirrorOf, writeMirror } from "../lib/store/mirror.js";
import { buildPhrase } from "../lib/store/phrase.js";
import { deletePhrase, listPhrases, putMissingPhrases, putPhrase } from "../lib/store/vocab.js";

/**
 * @param {import("../lib/config.js").Config} config
 * @returns {{ langFrom: string, langTo: string }}
 */
function pairOf(config) {
  return { langFrom: config.sourceLang, langTo: config.targetLang };
}

/**
 * @param {import("../lib/config.js").Config} config
 * @returns {Promise<import("../lib/protocol.js").VocabEntry[]>}
 */
async function rebuildMirror(config) {
  const phrases = await listPhrases(pairOf(config));
  const mirror = mirrorOf(config, phrases);
  await writeMirror(mirror);
  return mirror.entries;
}

/**
 * Kept out of the message path: an install or an update is the one moment the
 * mirror can be missing while the database is not - a new version with a
 * different shape, or storage cleared under a database that survived.
 *
 * @returns {Promise<void>}
 */
export async function refreshVocabulary() {
  await rebuildMirror(await readConfig());
}

/**
 * @param {import("../lib/protocol.js").SavePhraseRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<null>>}
 */
export async function savePhrase(request) {
  const config = await readConfig();
  const built = buildPhrase({
    text: request.text,
    translations: request.translations,
    langFrom: config.sourceLang,
    langTo: config.targetLang,
    id: crypto.randomUUID(),
    now: Date.now(),
  });
  if (!built.ok) return built;

  await putPhrase(built.value);
  await rebuildMirror(config);
  return ok(null);
}

/**
 * Forgetting something that was never saved is not a failure - the button says
 * "learned", and it is true either way.
 *
 * @param {import("../lib/protocol.js").ForgetPhraseRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<null>>}
 */
export async function forgetPhrase(request) {
  const normalized = normalize(request.text);
  if (normalized.length === 0) return ok(null);

  const config = await readConfig();
  const forgotten = await deletePhrase({ ...pairOf(config), normalized });
  // Only when something changed: an untouched mirror written again is a storage
  // event in every open tab, and every one of them would rebuild for nothing.
  if (forgotten) await rebuildMirror(config);
  return ok(null);
}

/**
 * A file's worth of phrases, added to the configured pair - and only added:
 * a phrase already saved keeps its meanings. Rows the store cannot accept -
 * too long, or nothing left once normalized - are counted rather than fatal,
 * because one broken line must not cost the rest of the file.
 *
 * `createdAt` steps by one millisecond per row, so the file's order survives
 * into the next export - which is what keeps oldest-first meaning something
 * across a roundtrip through another device.
 *
 * @param {import("../lib/protocol.js").ImportPhrasesRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").ImportReport>>}
 */
export async function importPhrases(request) {
  const config = await readConfig();
  const now = Date.now();

  /** @type {import("../lib/store/phrase.js").Phrase[]} */
  const rows = [];
  let invalid = 0;
  for (const [at, row] of request.rows.entries()) {
    const built = buildPhrase({
      text: row.text,
      translations: row.translations,
      langFrom: config.sourceLang,
      langTo: config.targetLang,
      id: crypto.randomUUID(),
      now: now + at,
    });
    if (built.ok) rows.push(built.value);
    else invalid += 1;
  }

  const { added, skipped } = await putMissingPhrases(rows);
  // Nothing added means the mirror already tells the truth, and rewriting it
  // would ping every open tab for nothing - the same restraint as forgetting.
  if (added > 0) await rebuildMirror(config);
  return ok({ added, skipped, invalid });
}

/**
 * The repair path. A page asks for this when the mirror it found describes a
 * different language pair than the one being read, and the answer doubles as
 * the rebuild.
 *
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").VocabEntry[]>>}
 */
export async function listVocabulary() {
  return ok(await rebuildMirror(await readConfig()));
}
