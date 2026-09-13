import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULTS, withDefaults } from "../src/lib/config.js";
import { markRecord } from "../src/lib/reader/marks.js";
import { fromArchiveText } from "../src/lib/store/articles-archive.js";
import {
  BACKUP_ENTRIES,
  BACKUP_FILENAME,
  BACKUP_VERSION,
  backupEntries,
  fromManifest,
  isNewerBackup,
  manifestOf,
} from "../src/lib/store/backup-file.js";
import { fromMarksCopy } from "../src/lib/store/marks-copy.js";
import { savedArticle } from "../src/lib/store/saved-article.js";
import { fromSettingsFile } from "../src/lib/store/settings-file.js";
import { fromVocabularyFile, vocabularyRows } from "../src/lib/store/vocabulary-file.js";

/**
 * The backup of everything (D213): a manifest and the parts, each exactly
 * the file its own module writes - so each comes back through its own
 * reader. The ZIP itself is the reader page's; here the entries are values.
 */

/**
 * @param {string} path
 * @returns {import("../src/lib/store/saved-article.js").SavedArticle}
 */
function article(path) {
  const built = savedArticle({
    url: `https://example.com/${path}`,
    title: `Title of ${path}`,
    content: `<p>Body of ${path}</p>`,
    savedAt: 1000,
  });
  assert.ok(built !== null);
  return { ...built, readAt: null };
}

/**
 * @param {string} text
 * @param {Partial<import("../src/lib/store/phrase.js").Phrase>} [rest]
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(text, rest = {}) {
  return {
    id: "id-" + text,
    langFrom: "en",
    langTo: "pl",
    phrase: text,
    normalized: text.toLowerCase(),
    translations: ["znaczenie"],
    createdAt: 10,
    ...rest,
  };
}

/** @returns {import("../src/lib/reader/marks.js").Mark} */
function mark() {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: 4 },
    color: "yellow",
    createdAt: 5,
    text: "Body",
  });
  assert.ok(built !== null);
  return built;
}

/** @returns {import("../src/lib/store/backup-file.js").BackupInput} */
function input() {
  const one = article("one");
  return {
    app: "0.5.56",
    now: 1234,
    articles: [one, article("two")],
    marks: new Map([[one.url, [mark()]]]),
    pictures: new Map(),
    positions: new Map([[one.url, { docId: one.url, segmentIndex: 0, blockIndex: 3, updatedAt: 7 }]]),
    phrases: [phrase("bank", { recallCount: 2 }), phrase("Haus", { langFrom: "de" })],
    highlights: [{ kind: "article", url: one.url, title: one.title, marks: [mark()] }],
    // With a pair chosen: a pair of nulls is no choice, and no patch.
    settings: withDefaults({ ...DEFAULTS, sourceLang: "en", targetLang: "pl", ttsRate: 120 }),
  };
}

/** @param {Uint8Array} data */
const text = (data) => new TextDecoder().decode(data);

describe("the backup of everything", () => {
  it("is named for what it is, and says in its manifest what it holds", () => {
    assert.equal(BACKUP_FILENAME, "reread-backup.zip");
    const manifest = manifestOf(input());
    assert.deepEqual(manifest, {
      format: "reread-backup",
      version: BACKUP_VERSION,
      createdAt: 1234,
      app: "0.5.56",
      holds: { phrases: 2, pairs: 2, highlights: 1, articles: 2, pictures: false, settings: true },
    });
  });

  it("writes the manifest first, then each part exactly as its own module writes it", () => {
    const entries = backupEntries(input());
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [BACKUP_ENTRIES.manifest, BACKUP_ENTRIES.vocabulary, BACKUP_ENTRIES.highlights, BACKUP_ENTRIES.settings, BACKUP_ENTRIES.articles],
    );
    const byName = new Map(entries.map((entry) => [entry.name, text(entry.data)]));
    const manifest = fromManifest(byName.get(BACKUP_ENTRIES.manifest) ?? "");
    assert.ok(manifest !== null);
    assert.equal(manifest.holds.phrases, 2);
    // Each part comes back through the reader it always had.
    assert.deepEqual(fromVocabularyFile(byName.get(BACKUP_ENTRIES.vocabulary) ?? "").rows, vocabularyRows(input().phrases));
    assert.equal(fromMarksCopy(byName.get(BACKUP_ENTRIES.highlights) ?? "").documents.length, 1);
    assert.deepEqual(fromSettingsFile(byName.get(BACKUP_ENTRIES.settings) ?? ""), input().settings);
    const list = fromArchiveText(byName.get(BACKUP_ENTRIES.articles) ?? "");
    assert.equal(list.articles.length, 2);
    // The reading list's positions travel with the articles (D213).
    assert.deepEqual(list.articles[0]?.position, { docId: article("one").url, segmentIndex: 0, blockIndex: 3, updatedAt: 7 });
  });

  it("leaves the settings out when not asked for, and still says so in the manifest", () => {
    const without = { ...input(), settings: null };
    assert.equal(manifestOf(without).holds.settings, false);
    assert.equal(backupEntries(without).some((entry) => entry.name === BACKUP_ENTRIES.settings), false);
  });

  it("reads a manifest with its claims healed, and none out of a text that is not one", () => {
    assert.equal(fromManifest("not json"), null);
    assert.equal(fromManifest(JSON.stringify({ format: "reread-articles" })), null);
    const healed = fromManifest(JSON.stringify({ format: "reread-backup", version: "2", holds: { phrases: -1, pictures: "yes" } }));
    assert.deepEqual(healed, {
      format: "reread-backup",
      version: BACKUP_VERSION,
      createdAt: 0,
      app: "",
      holds: { phrases: 0, pairs: 0, highlights: 0, articles: 0, pictures: false, settings: false },
    });
  });

  it("knows a file written by a newer re/read - the one thing the version gates", () => {
    const newer = fromManifest(JSON.stringify({ format: "reread-backup", version: BACKUP_VERSION + 1 }));
    assert.ok(newer !== null);
    assert.equal(isNewerBackup(newer), true);
    assert.equal(isNewerBackup(manifestOf(input())), false);
  });
});
