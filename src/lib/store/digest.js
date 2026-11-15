/**
 * Telling whether a piece of stored text changed, and dealing keys into
 * buckets - the two things the copies in `storage.local` need to be written
 * a piece at a time (D297 for the vocabulary's copy, D299 for the pages'
 * mirror).
 *
 * Not a secret and not a signature: thirty-two bits of FNV-1a, with the
 * length beside it where a change has to be told. A digest that collides
 * costs one bucket one late write; a collision in dealing costs nothing at
 * all, since two keys in one bucket is what a bucket is.
 */

/**
 * FNV-1a over a string's code units.
 *
 * @param {string} text
 * @returns {number} an unsigned thirty-two bit number
 */
export function hash32(text) {
  let value = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    value ^= text.charCodeAt(at);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * What tells one text from another without keeping either: its length and
 * its hash.
 *
 * @param {string} text
 * @returns {string}
 */
export function digestOf(text) {
  return `${text.length.toString(36)}-${hash32(text).toString(36)}`;
}

/**
 * Which of `count` buckets a key lives in - by the key alone, so it stays
 * where it is whatever else changes about its row.
 *
 * @param {string} key
 * @param {number} count
 * @returns {number}
 */
export function bucketFor(key, count) {
  return hash32(key) % count;
}
