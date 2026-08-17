/**
 * The file the reading list travels in - out as a backup or to another
 * browser, and back in without ever duplicating an article.
 *
 * The format is one JSON object: a `format` marker naming what the file is, a
 * `version` for a future reader, and the articles as they are stored - minus
 * the hostname, which import derives again the way saving does, so a file
 * cannot make a row lie about its own address. JSON rather than the
 * vocabulary's TSV because an article's content is rebuilt markup - text full
 * of newlines and tabs that TSV's no-escaping rule could not carry - and
 * rather than an archive of files because reading an archive means shipping
 * code to read archives.
 *
 * An article's highlighter marks (D106) ride beside it as an optional
 * `marks` array - additive, so the version stays 1: a file without the field
 * is every file written before the highlighter, and an older reader ignores
 * fields it never asks about. Import restores them only for the articles it
 * actually adds; an article already saved keeps its copy untouched in the
 * whole, marks included - the standing promise.
 *
 * Import adds and never overwrites, exactly the phrase import's promise. The
 * key is the article's address - the same `url` that is the database's primary
 * key, so "no duplicates" here and "one row per address" there are one rule.
 * Everything in this module is a value in and a value out; the database lives
 * in `articles.js`.
 */

import { MAX_PAGE_HTML } from "../protocol.js";
import { asMark, compareMarks } from "../reader/marks.js";
import { savedArticle } from "./saved-article.js";

/** @typedef {import("./saved-article.js").SavedArticle} SavedArticle */
/** @typedef {import("../reader/marks.js").Mark} Mark */

/**
 * An article as the file carries it: the stored row, plus the marks riding
 * beside it when it has any.
 *
 * @typedef {SavedArticle & { marks?: Mark[] }} FileArticle
 */

/**
 * The most marks one entry may bring in. Far above any honest reading - a
 * document with a thousand highlights is a document painted over - and low
 * enough that a hand-made file cannot plant a megabyte row behind one
 * address. Kept in file order up to the cap, then sorted like everything
 * else.
 */
const MAX_MARKS_PER_ARTICLE = 1000;

/** What the file says it is, and the first thing reading one checks. */
const FORMAT = "reread-articles";

/**
 * Written for whoever reads this file after the format grows. Reading ignores
 * it today: whether an entry is an article is decided entry by entry, so a
 * newer file yields what this version can read and counts the rest.
 */
const VERSION = 1;

/**
 * What the exported file is called. No language pair and no date: the list is
 * one list, and a browser numbers a second download by itself.
 */
export const ARTICLES_FILENAME = "reread-articles.json";

/**
 * @typedef {object} ArticlesFile
 * @property {FileArticle[]} articles every entry that was an article
 * @property {number} invalid entries that were not, counted rather than kept
 */

/**
 * The whole file, as one string. Articles are written oldest saved first with
 * the address as the tie, so two exports of the same list are the same file -
 * diffable, like the vocabulary's. Indented because the point of the file is
 * that somebody can open it and see their reading. An article with marks
 * carries them; one without carries no field at all, so the file of somebody
 * who never picked up the pen reads exactly as it always did.
 *
 * @param {SavedArticle[]} articles
 * @param {Map<string, Mark[]>} [marks] each article's marks, keyed by `url`
 * @returns {string}
 */
export function toArticlesFile(articles, marks = new Map()) {
  const rows = [...articles]
    .sort((a, b) => a.savedAt - b.savedAt || a.url.localeCompare(b.url))
    .map(({ url, title, savedAt, readAt, content, dir, lang }) => {
      const kept = marks.get(url);
      return {
        url,
        title,
        savedAt,
        readAt,
        content,
        dir,
        lang,
        ...(kept === undefined || kept.length === 0 ? {} : { marks: kept }),
      };
    });
  return JSON.stringify({ format: FORMAT, version: VERSION, articles: rows }, null, 2) + "\n";
}

/**
 * Reads what `toArticlesFile` writes. A file that is not ours at all - not
 * JSON, no marker - holds zero articles rather than throwing: the page turns
 * that into one sentence. A broken entry between good ones is counted and
 * dropped, the TSV's rule: one bad entry must not cost the file, and a count
 * the reader can see beats a silent shrug.
 *
 * @param {string} text
 * @returns {ArticlesFile}
 */
export function fromArticlesFile(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { articles: [], invalid: 0 };
  }
  if (typeof parsed !== "object" || parsed === null) return { articles: [], invalid: 0 };

  const { format, articles } = /** @type {Record<string, unknown>} */ (parsed);
  if (format !== FORMAT || !Array.isArray(articles)) return { articles: [], invalid: 0 };

  /** @type {SavedArticle[]} */
  const kept = [];
  let invalid = 0;
  for (const entry of articles) {
    const article = asFileArticle(entry);
    if (article === null) invalid += 1;
    else kept.push(article);
  }
  return { articles: kept, invalid };
}

/**
 * One entry as an article, or null. The gate is `savedArticle` - the same one
 * a save press goes through, so nothing enters by import that could not have
 * entered by reading: address parseable, content there, hostname and title
 * derived fresh rather than believed.
 *
 * On top of it, two rules of the file's own. Content larger than the biggest
 * page the reader can ever be handed (`MAX_PAGE_HTML`) cannot be a real
 * export, and refusing it here keeps a hand-made file from planting megabytes.
 * And the read state travels: restoring a backup restores which pile
 * everything was on, with anything unreadable reading as unread - the same
 * lean `asSavedMeta` has.
 *
 * @param {unknown} value
 * @returns {FileArticle | null}
 */
function asFileArticle(value) {
  if (typeof value !== "object" || value === null) return null;
  const { url, title, savedAt, readAt, content, dir, lang, marks } =
    /** @type {Record<string, unknown>} */ (value);

  if (typeof url !== "string" || typeof content !== "string") return null;
  if (typeof savedAt !== "number") return null;
  if (content.length > MAX_PAGE_HTML) return null;

  const built = savedArticle({
    url,
    title: typeof title === "string" ? title : "",
    content,
    dir: typeof dir === "string" ? dir : null,
    lang: typeof lang === "string" ? lang : null,
    savedAt,
  });
  if (built === null) return null;

  const kept = asFileMarks(marks);
  return {
    ...built,
    readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null,
    ...(kept.length === 0 ? {} : { marks: kept }),
  };
}

/**
 * The marks an entry brings, or as many of them as are marks: each one
 * narrowed by `asMark` - the entry is not refused over a broken mark, the
 * lean the whole file reads by - capped, and put in reading order however
 * the file held them.
 *
 * @param {unknown} value
 * @returns {Mark[]}
 */
function asFileMarks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_MARKS_PER_ARTICLE)
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
}

/**
 * Which of a file's articles would actually be written, given the addresses
 * already saved. Import only adds: an address already in the list keeps its
 * copy untouched - its content, its title, its read mark - and is counted
 * skipped. A file naming the same address twice adds it once, the first
 * winning, the twin counted with the rest. Running the same file again
 * therefore adds nothing, which is what makes pressing Import twice safe.
 *
 * Pure so that `node --test` can hold the promise down; the database calls
 * this inside the one transaction that also writes. Generic over the row,
 * so whatever an entry carries beyond the article - its marks - comes out
 * the other side with it.
 *
 * @template {SavedArticle} T
 * @param {string[]} existingUrls
 * @param {T[]} articles
 * @returns {{ toAdd: T[], skipped: number }}
 */
export function importPlan(existingUrls, articles) {
  const taken = new Set(existingUrls);
  /** @type {T[]} */
  const toAdd = [];
  let skipped = 0;
  for (const article of articles) {
    if (taken.has(article.url)) {
      skipped += 1;
      continue;
    }
    taken.add(article.url);
    toAdd.push(article);
  }
  return { toAdd, skipped };
}
