/**
 * One listener on `storage.onChanged` per page, however many modules on it
 * want to hear a change (D297).
 *
 * A listener is not free where it looks free. Firefox hands every listener
 * its own copy of every change: each registration deserializes the old and
 * the new value of every key that moved, in the page that registered it,
 * whether the listener reads that key or not (`child/ext-storage.js`,
 * `makeOnChangedEventTarget`). The reader page had four listeners, so a
 * save that rewrote the pages' mirror was read into that page eight times
 * over - on an e-ink reader with five thousand phrases, the seconds a
 * press went unanswered (Michał's report, 2026-11-15). There is no way to
 * ask the browser for one key only, so the saving is in asking once: the
 * modules register here, and the browser hears of one listener.
 *
 * The browser's listener stands only while somebody listens: the first
 * registration adds it and the last removal takes it away, so a content
 * script that was switched off for a site leaves nothing behind.
 */

import { webext } from "./browser.js";

/**
 * @typedef {(changes: Record<string, { oldValue?: unknown, newValue?: unknown }>, area: string) => void} ChangeListener
 */

/** @type {Set<ChangeListener>} */
const listeners = new Set();

/**
 * The one function the browser calls. Each listener hears the change
 * whatever the one before it did: a listener that throws is the browser's
 * to report, as it would have been registered on its own, and the others
 * still hear the change first.
 *
 * @type {ChangeListener}
 */
function dispatch(changes, area) {
  /** @type {unknown[]} */
  const thrown = [];
  // A copy of the set: a listener may remove itself, or add another, while
  // it is being called.
  for (const listener of [...listeners]) {
    try {
      listener(changes, area);
    } catch (error) {
      thrown.push(error);
    }
  }
  if (thrown.length > 0) throw thrown[0];
}

/**
 * @param {ChangeListener} listener called for every change, in every area -
 *   the same call `storage.onChanged` makes
 */
export function onStorageChanged(listener) {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) webext().storage.onChanged.addListener(dispatch);
}

/**
 * @param {ChangeListener} listener one registered with `onStorageChanged`;
 *   removing one that was never registered does nothing
 */
export function offStorageChanged(listener) {
  if (!listeners.delete(listener)) return;
  if (listeners.size === 0) webext().storage.onChanged.removeListener(dispatch);
}
