/**
 * When the backup of everything was last written, and how much more is here
 * since (D288).
 *
 * The copies in `storage.local` outlive the database, not the profile: an
 * uninstall, a folder replaced under Chromium, a device lost - against those
 * only the file Export writes stands, and nothing wrote down when that last
 * happened. So Export leaves a stamp: the moment, and how much the device
 * held then. The reading list reads it back under the button and says how
 * long ago that was and how much more is here now - in the hint's grey, and
 * in the text's own ink once a month has passed with something new, or when
 * no file was ever written while something is here to lose. Never a dialog,
 * a notification or a badge: a reminder is a line where the button is.
 *
 * "More" is growth, not a list of additions: the counts here now against the
 * counts the stamp holds, each clamped at zero. A count is one `count()` off
 * a store, where a date per row would be a read of every row - and a read of
 * ten thousand phrases at every look at the list is the price this line must
 * not cost. What it loses is the case of more deleted than saved since the
 * file: a line that then understates, never one that nags over nothing.
 *
 * The books are counted as the shelf holds them, whatever the export's box
 * said: a book not ticked into the file is the choice the notes under the
 * buttons explain (keep the .epub), not something new since.
 *
 * Not from a private window: its database is the session's (PRIVACY), and a
 * file of that must not stand as the last backup of everything - the page
 * decides that, this module only writes what it is handed.
 *
 * The storage arrives as a parameter so the reading and the writing can be
 * tested against a stand-in; callers pass nothing.
 */

import { webext } from "../browser.js";
import { plural, t } from "../i18n.js";

/** The key in `storage.local`, beside the copies. */
export const EXPORT_STAMP_KEY = "backupExport";

const VERSION = 1;

const DAY = 24 * 60 * 60 * 1000;

/**
 * How old a backup may be before more since it puts the line in the text's
 * own ink. Not a rule about the date alone: a month-old backup with nothing
 * new since is as good as new.
 */
export const STALE_AFTER_DAYS = 30;

/**
 * What the device held when the file was written, in the parts the export
 * report counts.
 *
 * @typedef {{ phrases: number, articles: number, books: number, highlights: number }} Held
 */

/**
 * @typedef {object} ExportStamp
 * @property {1} version
 * @property {number} at epoch milliseconds, when the file was handed to the browser
 * @property {Held} held
 */

/**
 * @typedef {object} StampDeps
 * @property {() => Promise<unknown>} read whatever stands under the key
 * @property {(stamp: ExportStamp) => Promise<void>} write
 */

/** @returns {StampDeps} */
function defaults() {
  return {
    read: async () => (await webext().storage.local.get(EXPORT_STAMP_KEY))[EXPORT_STAMP_KEY],
    write: async (stamp) => {
      await webext().storage.local.set({ [EXPORT_STAMP_KEY]: stamp });
    },
  };
}

/** The parts in the order the export report lists them. */
const PARTS = /** @type {(keyof Held)[]} */ (["articles", "books", "phrases", "highlights"]);

/** The plural family each part is counted in - the export report's own. */
const FAMILIES = {
  articles: "reader_backup_articles",
  books: "reader_backup_books",
  phrases: "phrases",
  highlights: "reader_backup_highlights",
};

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * @param {number} now
 * @param {Held} held
 * @returns {ExportStamp}
 */
export function stampOf(now, held) {
  return {
    version: VERSION,
    at: now,
    held: { phrases: held.phrases, articles: held.articles, books: held.books, highlights: held.highlights },
  };
}

/**
 * A stored value narrowed back into a stamp, or nothing: written by this
 * extension, but a hand in storage or a version that wrote another shape
 * must not put a broken date under the button. Unknown fields are left
 * behind; a count that is not one reads as zero, so a stamp with a moment
 * is never thrown away over a part.
 *
 * @param {unknown} value
 * @returns {ExportStamp | null}
 */
export function asStamp(value) {
  if (typeof value !== "object" || value === null) return null;
  const { at, held } = /** @type {{ at?: unknown, held?: unknown }} */ (value);
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  const counts = typeof held === "object" && held !== null ? /** @type {Record<string, unknown>} */ (held) : {};
  /** @param {keyof Held} part */
  const countOf = (part) => {
    const count = counts[part];
    return isCount(count) ? count : 0;
  };
  return stampOf(at, {
    phrases: countOf("phrases"),
    articles: countOf("articles"),
    books: countOf("books"),
    highlights: countOf("highlights"),
  });
}

/**
 * The stamp as it stands, or nothing - also when the storage will not
 * answer: a line under a button must not turn a failed read into an error.
 *
 * @param {StampDeps} [deps]
 * @returns {Promise<ExportStamp | null>}
 */
export async function readExportStamp(deps = defaults()) {
  try {
    return asStamp(await deps.read());
  } catch {
    return null;
  }
}

/**
 * Quiet on failure, like the copies' rebuilds: the file is already on its
 * way, and the report under the button is about the file.
 *
 * @param {ExportStamp} stamp
 * @param {StampDeps} [deps]
 * @returns {Promise<boolean>} whether the stamp was written
 */
export async function writeExportStamp(stamp, deps = defaults()) {
  try {
    await deps.write(stamp);
    return true;
  } catch {
    return false;
  }
}

/**
 * How much more the device holds than it did when the file was written,
 * part by part and never below zero (growth, not additions - above).
 *
 * @param {Held} held
 * @param {Held} here
 * @returns {Held}
 */
export function grownSince(held, here) {
  return {
    phrases: Math.max(0, here.phrases - held.phrases),
    articles: Math.max(0, here.articles - held.articles),
    books: Math.max(0, here.books - held.books),
    highlights: Math.max(0, here.highlights - held.highlights),
  };
}

/**
 * How long ago a moment was, in the reader's language and in the coarsest
 * unit that still says something: days under a week, weeks under a month,
 * months under a year - "today", "yesterday", "3 weeks ago", "last month".
 * Elapsed time, not calendar days: "today" is the last twenty-four hours,
 * so the line cannot say "yesterday" ten minutes after the press.
 *
 * @param {number} at
 * @param {number} now
 * @param {string} locale
 * @returns {string}
 */
export function ago(at, now, locale) {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const days = Math.floor(Math.max(0, now - at) / DAY);
  if (days < 7) return format.format(-days, "day");
  if (days < 30) return format.format(-Math.floor(days / 7), "week");
  if (days < 365) return format.format(-Math.floor(days / 30), "month");
  return format.format(-Math.floor(days / 365), "year");
}

/**
 * The counted parts as the export report lists them, the empty ones left
 * out - "0 books" would say the file lacks them, which is another sentence.
 *
 * @param {Held} held
 * @returns {string[]}
 */
function partsOf(held) {
  return PARTS.filter((part) => held[part] > 0).map((part) => plural(held[part], FAMILIES[part]));
}

/**
 * The line under Export, or nothing to say: with no stamp and nothing here,
 * a fresh install is not told to back up its settings. With no stamp and
 * something here, the line counts what stands to be lost, in the text's
 * ink. With a stamp, the age and the growth since - the ink only once the
 * file is `STALE_AFTER_DAYS` old and something is here that it does not
 * hold.
 *
 * @param {ExportStamp | null} stamp
 * @param {Held} here what the device holds now
 * @param {number} now
 * @param {string} locale
 * @returns {{ text: string, due: boolean } | null}
 */
export function backupReminder(stamp, here, now, locale) {
  if (stamp === null) {
    const parts = partsOf(here);
    if (parts.length === 0) return null;
    return {
      text: [t("reader_last_backup_never"), t("reader_last_backup_here", parts.join(", "))].join(" "),
      due: true,
    };
  }
  const parts = partsOf(grownSince(stamp.held, here));
  const since = parts.length === 0 ? t("reader_last_backup_nothing") : t("reader_last_backup_more", parts.join(", "));
  return {
    text: [t("reader_last_backup", ago(stamp.at, now, locale)), since].join(" "),
    due: parts.length > 0 && now - stamp.at >= STALE_AFTER_DAYS * DAY,
  };
}
