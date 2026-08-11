/**
 * From a parsed dictionary to the rows that go into the database.
 *
 * The one rule that matters here: a dictionary is keyed by the same
 * `normalize()` that keys the vocabulary. Not something similar, the same
 * function - or a phrase saved as one thing would be looked up as another, and
 * the two halves of this extension would disagree about what "the same word"
 * means. It also means the key rules only exist once, so a change to them is
 * still a change in one place.
 *
 * Normalising collapses spellings the dictionary kept apart (`Bank` and `bank`,
 * `naïve` and `naive` do not, but case does), so entries can land on one key.
 * They are merged rather than fought over: two meanings of one word are exactly
 * what the second layer of the bubble is for.
 */

import { normalize } from "../normalize.js";
import { LIMITS } from "./text.js";

/**
 * @typedef {object} DictionaryRow
 * @property {string} dictId
 * @property {string} key `normalize(headword)`
 * @property {string} headword as the dictionary spells it
 * @property {string[]} senses empty in an alias row
 * @property {string} [aliasOf] the key this word is another spelling of
 */

/**
 * @param {string} text
 * @returns {number} how many bytes this would be as UTF-8
 */
function utf8Length(text) {
  let total = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code < 0x80) total += 1;
    else if (code < 0x800) total += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      total += 4;
      at += 1;
    } else total += 3;
  }
  return total;
}

/**
 * @param {DictionaryRow} row
 * @returns {number}
 */
function rowBytes(row) {
  let total = utf8Length(row.key) + utf8Length(row.headword) + utf8Length(row.aliasOf ?? "");
  for (const sense of row.senses) total += utf8Length(sense);
  return total;
}

/**
 * @param {string} dictId
 * @param {import("./import.js").ParsedDictionary} parsed
 * @returns {{ rows: DictionaryRow[], entryCount: number, aliasCount: number, bytes: number }}
 */
export function toRows(dictId, parsed) {
  /** @type {Map<string, DictionaryRow>} */
  const byKey = new Map();

  for (const entry of parsed.entries) {
    const key = normalize(entry.headword);
    // A headword that is nothing but punctuation has no key to be found under.
    if (key.length === 0) continue;

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { dictId, key, headword: entry.headword, senses: [...entry.senses] });
      continue;
    }

    // Homographs arrive as separate entries under one word, and a dictionary
    // that repeats itself should not make the bubble repeat itself.
    for (const sense of entry.senses) {
      if (existing.senses.length >= LIMITS.senses) break;
      if (!existing.senses.includes(sense)) existing.senses.push(sense);
    }
  }

  const entryCount = byKey.size;

  /** @type {DictionaryRow[]} */
  const aliases = [];
  for (const alias of parsed.aliases) {
    const key = normalize(alias.headword);
    if (key.length === 0) continue;
    // An alias never shadows a word the dictionary has in its own right, and
    // never points at itself: `dogs` may be a synonym of `dog`, but if `dogs`
    // has its own entry, that entry is the better answer.
    if (byKey.has(key)) continue;

    const target = parsed.entries[alias.target];
    if (target === undefined) continue;
    const targetKey = normalize(target.headword);
    if (targetKey.length === 0 || targetKey === key) continue;

    byKey.set(key, { dictId, key, headword: alias.headword, senses: [], aliasOf: targetKey });
    aliases.push(/** @type {DictionaryRow} */ (byKey.get(key)));
  }

  const rows = [...byKey.values()];
  let bytes = 0;
  for (const row of rows) bytes += rowBytes(row);

  return { rows, entryCount, aliasCount: aliases.length, bytes };
}
