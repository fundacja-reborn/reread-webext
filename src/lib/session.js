/**
 * Everything this extension keeps for the length of a browser session, which is
 * two numbers and nothing else.
 *
 * `storage.local` holds what has to survive a restart - the settings and the
 * copy of the vocabulary pages read. `storage.session` holds what must *not*:
 * tab ids. Ids start over when the browser does, so one written to `local`
 * would name a stranger's tab the next morning, and the toolbar button would
 * jump to it. Session storage lasts exactly as long as a tab id means anything,
 * and it survives the event page being killed, which a variable would not.
 *
 * Neither key carries anything about what is being read. The page the reader
 * shows travels as one answer to one question and is never written down - the
 * same answer O2 and O3 gave to storing context and source URLs, for the same
 * reason: an address is browsing history, and this extension does not keep any.
 */

import { webext } from "./browser.js";

/** Which tab the reader is, so pressing the button twice does not open two. */
export const READER_TAB_KEY = "readerTabId";

/**
 * Which tab the reader was last pointed at, and when. The timestamp is not
 * decoration: pressing the button twice on the same page has to reach the
 * reader, and a value that did not change is a `storage.onChanged` that never
 * fires.
 */
export const READER_SOURCE_KEY = "readerSource";

/** @typedef {{ tabId: number, at: number }} ReaderSource */

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<number | null>}
 */
export async function readReaderTab(session = webext().storage.session) {
  const stored = await session.get(READER_TAB_KEY);
  const id = stored[READER_TAB_KEY];
  return typeof id === "number" ? id : null;
}

/**
 * @param {number | null} tabId
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeReaderTab(tabId, session = webext().storage.session) {
  if (tabId === null) await session.remove(READER_TAB_KEY);
  else await session.set({ [READER_TAB_KEY]: tabId });
}

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<ReaderSource | null>}
 */
export async function readReaderSource(session = webext().storage.session) {
  const stored = await session.get(READER_SOURCE_KEY);
  const source = stored[READER_SOURCE_KEY];
  if (typeof source !== "object" || source === null) return null;
  const { tabId, at } = /** @type {Record<string, unknown>} */ (source);
  if (typeof tabId !== "number" || typeof at !== "number") return null;
  return { tabId, at };
}

/**
 * @param {ReaderSource} source
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeReaderSource(source, session = webext().storage.session) {
  await session.set({ [READER_SOURCE_KEY]: source });
}

/**
 * Points the reader at nothing, which is how the reader ends up on its reading
 * list. Written rather than removed: the reader reacts to the key *changing*,
 * and removing a key that is already absent is a change nobody hears. The
 * value fails `readReaderSource`'s validation on purpose - a source with no
 * tab reads back as no source, and the timestamp is what makes each press an
 * event of its own.
 *
 * @param {() => number} [now]
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function clearReaderSource(now = Date.now, session = webext().storage.session) {
  await session.set({ [READER_SOURCE_KEY]: { at: now() } });
}
