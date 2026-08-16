/**
 * Which kind of reading a picked file is - the whole decision behind the one
 * Import button of the reading list, which takes both the list's own .json
 * backup and an EPUB book. Pure, so the order of evidence can sit under
 * `node --test`: the name first (the strongest word the picker gives),
 * then the declared type, then the file's own first bytes (every EPUB is
 * a ZIP and opens with "PK"). A file that answers to none of them falls
 * to the articles reader, whose "there are no articles in that file" is
 * the gentler of the two failure sentences.
 */

/** @typedef {"articles" | "book"} ImportKind */

/** The first two bytes of every ZIP archive, and so of every EPUB. */
const ZIP_MAGIC = [0x50, 0x4b];

/**
 * @param {{ name: string, type: string, head: Uint8Array }} file
 *   `head` is however many opening bytes the caller cared to read; fewer
 *   than the magic needs simply leaves that voice out of the decision.
 * @returns {ImportKind}
 */
export function importKind({ name, type, head }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".epub")) return "book";
  if (lower.endsWith(".json")) return "articles";
  if (type.includes("epub")) return "book";
  if (type.includes("json")) return "articles";
  if (ZIP_MAGIC.every((byte, at) => head[at] === byte)) return "book";
  return "articles";
}
