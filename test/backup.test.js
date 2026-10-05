import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKUP_DELAY_MS,
  asBackup,
  backupOf,
  backupScheduler,
  ensureBackup,
  readBackupSummary,
  rebuildBackup,
  restoreVocabulary,
} from "../src/lib/store/backup.js";

/** @typedef {import("../src/lib/store/phrase.js").Phrase} Phrase */
/** @typedef {import("../src/lib/store/backup.js").BackupDeps} BackupDeps */

/**
 * The copy of the vocabulary that outlives the database, held to its three
 * rules: written whole and only from a store that could be read, restored
 * only into an empty store, never touching a row that exists. No browser
 * runs in CI - the store and the storage are stand-ins that remember what was
 * asked of them and in what order.
 */

/**
 * @param {string} id
 * @param {Partial<Phrase>} [over]
 * @returns {Phrase}
 */
function phrase(id, over = {}) {
  return {
    id,
    langFrom: "en",
    langTo: "pl",
    phrase: `word ${id}`,
    normalized: `word ${id}`,
    translations: ["słowo"],
    createdAt: 1000 + Number(id),
    ...over,
  };
}

/**
 * @param {{ phrases?: Phrase[], listFails?: boolean, stored?: unknown, putMissing?: (rows: Phrase[]) => { added: number, skipped: number } }} [script]
 */
function standIn(script = {}) {
  const phrases = script.phrases ?? [];
  /** @type {string[]} */
  const asked = [];
  /** @type {import("../src/lib/store/backup.js").VocabBackup | undefined} */
  let written;
  /** @type {BackupDeps} */
  const deps = {
    empty: async () => {
      asked.push("empty");
      return phrases.length === 0;
    },
    list: async () => {
      asked.push("list");
      if (script.listFails === true) throw new Error("the store would not open");
      return phrases;
    },
    putMissing: async (rows) => {
      asked.push(`putMissing ${rows.length}`);
      return script.putMissing === undefined ? { added: rows.length, skipped: 0 } : script.putMissing(rows);
    },
    read: async () => {
      asked.push("read");
      return script.stored;
    },
    write: async (backup) => {
      asked.push("write");
      written = backup;
    },
    now: () => 42,
  };
  return { deps, asked, written: () => written };
}

describe("the copy of the vocabulary", () => {
  it("survives a trip through JSON with every field, the optional ones included", () => {
    const rows = [phrase("1"), phrase("2", { langFrom: "de", context: "ein Satz", sourceUrl: "https://example.org/" })];
    const stored = JSON.parse(JSON.stringify(backupOf(rows, 42)));
    assert.deepEqual(asBackup(stored), { version: 1, writtenAt: 42, phrases: rows });
  });

  it("carries the counts (D209) as counts, and restores a phrase without a count that is not one", () => {
    const counted = phrase("1", { recallCount: 3, lastRecallAt: 50, readCount: 12, lastReadAt: 60 });
    assert.deepEqual(asBackup(JSON.parse(JSON.stringify(backupOf([counted], 42))))?.phrases, [counted]);

    const narrowed = asBackup({
      version: 1,
      writtenAt: 1,
      phrases: [
        { ...phrase("2"), recallCount: "3", lastRecallAt: 50 },
        { ...phrase("3"), recallCount: -1, readCount: 1.5 },
        { ...phrase("4"), lastRecallAt: 50, lastReadAt: 60 },
        { ...phrase("5"), recallCount: 0, readCount: 0 },
        { ...phrase("6"), recallCount: 2, lastRecallAt: "then" },
      ],
    });
    assert.deepEqual(narrowed?.phrases, [
      phrase("2"),
      phrase("3"),
      phrase("4"),
      phrase("5"),
      { ...phrase("6"), recallCount: 2 },
    ]);
  });

  it("carries the learned mark (D224) as a moment, and restores a phrase without a mark that is not one", () => {
    const marked = phrase("1", { learnedAt: 5000 });
    assert.deepEqual(asBackup(JSON.parse(JSON.stringify(backupOf([marked], 42))))?.phrases, [marked]);
    const narrowed = asBackup({
      version: 1,
      writtenAt: 1,
      phrases: [
        { ...phrase("2"), learnedAt: "5000" },
        { ...phrase("3"), learnedAt: 0 },
        { ...phrase("4"), learnedAt: -1 },
        { ...phrase("5"), learnedAt: 7000, recallCount: 2 },
      ],
    });
    assert.deepEqual(narrowed?.phrases, [phrase("2"), phrase("3"), phrase("4"), { ...phrase("5"), recallCount: 2, learnedAt: 7000 }]);
  });

  it("is no copy at all in another shape, and drops the rows that make no sense", () => {
    assert.equal(asBackup(undefined), null);
    assert.equal(asBackup(null), null);
    assert.equal(asBackup({ version: 2, writtenAt: 1, phrases: [] }), null);
    assert.equal(asBackup({ version: 1, writtenAt: "yesterday", phrases: [] }), null);
    assert.equal(asBackup({ version: 1, writtenAt: 1 }), null);

    const kept = phrase("1");
    const narrowed = asBackup({
      version: 1,
      writtenAt: 1,
      phrases: [
        kept,
        { ...phrase("2"), translations: [] },
        { ...phrase("3"), id: "" },
        { ...phrase("4"), createdAt: "then" },
        { ...phrase("5"), extra: "field" },
        "not a row",
      ],
    });
    assert.deepEqual(narrowed?.phrases, [kept, phrase("5")], "the good rows, without the unknown field");
  });

  it("restores only into an empty store, and asks the store before it reads the copy", async () => {
    const wiped = standIn({ phrases: [], stored: backupOf([phrase("1"), phrase("2"), phrase("3")], 1) });
    assert.equal(await restoreVocabulary(wiped.deps), 3);
    assert.deepEqual(wiped.asked, ["empty", "read", "putMissing 3"]);

    const full = standIn({ phrases: [phrase("9")], stored: backupOf([phrase("1")], 1) });
    assert.equal(await restoreVocabulary(full.deps), 0);
    assert.deepEqual(full.asked, ["empty"], "a store with phrases must not even cost the copy's read");
  });

  it("brings nothing back from no copy, an empty copy, or a copy of rows that already exist", async () => {
    assert.equal(await restoreVocabulary(standIn({ stored: undefined }).deps), 0);
    assert.equal(await restoreVocabulary(standIn({ stored: backupOf([], 1) }).deps), 0);
    const skipped = standIn({
      stored: backupOf([phrase("1"), phrase("2")], 1),
      putMissing: () => ({ added: 1, skipped: 1 }),
    });
    assert.equal(await restoreVocabulary(skipped.deps), 1, "only what was actually added counts as restored");
  });

  it("is rebuilt whole from the store, and not at all from a store that would not answer", async () => {
    const rows = [phrase("1"), phrase("2")];
    const fine = standIn({ phrases: rows });
    assert.equal(await rebuildBackup(fine.deps), 2);
    assert.deepEqual(fine.written(), backupOf(rows, 42));

    const broken = standIn({ phrases: rows, listFails: true });
    await assert.rejects(() => rebuildBackup(broken.deps));
    assert.equal(broken.written(), undefined, "a copy replaced by a guess");
    assert.deepEqual(broken.asked, ["list"]);
  });

  it("is written once for a vocabulary that has none, and left alone otherwise", async () => {
    const before = standIn({ phrases: [phrase("1")], stored: undefined });
    assert.equal(await ensureBackup(before.deps), true);
    assert.deepEqual(before.written(), backupOf([phrase("1")], 42));

    const already = standIn({ phrases: [phrase("1")], stored: backupOf([phrase("1")], 7) });
    assert.equal(await ensureBackup(already.deps), false);
    assert.equal(already.written(), undefined);

    const nothing = standIn({ phrases: [], stored: undefined });
    assert.equal(await ensureBackup(nothing.deps), false, "an empty store has nothing to copy");
    assert.equal(nothing.written(), undefined);
  });

  it("tells the settings page how many phrases the copy holds, since when and what it weighs", async () => {
    assert.equal(await readBackupSummary(standIn({ stored: undefined }).deps), null);
    const summary = await readBackupSummary(standIn({ stored: backupOf([phrase("1"), phrase("2")], 9) }).deps);
    assert.equal(summary?.count, 2);
    assert.equal(summary?.writtenAt, 9);
    // The size is the copy's own JSON, measured while it is already parsed:
    // the settings page counts the vocabulary into its breakdown of the
    // space, and a second read of the same key to weigh it would be a read
    // for nothing.
    assert.ok((summary?.bytes ?? 0) > 0, "the copy weighs nothing");
  });
});

describe("the copy rebuilt off the write's path (D295)", () => {
  /** A clock the test turns by hand: the timers fire in order of their due time. */
  function clock() {
    let now = 0;
    let next = 0;
    /** @type {Map<number, { at: number, work: () => void }>} */
    const timers = new Map();
    return {
      /** @param {() => void} work @param {number} ms */
      setTimer: (work, ms) => {
        next += 1;
        timers.set(next, { at: now + ms, work });
        return next;
      },
      /** @param {unknown} timer */
      clearTimer: (timer) => {
        timers.delete(/** @type {number} */ (timer));
      },
      /** @param {number} ms */
      async tick(ms) {
        now += ms;
        for (const [id, { at, work }] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
          if (at > now) break;
          timers.delete(id);
          work();
          // The rebuild's promises settle before the next timer fires.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      },
      armed: () => timers.size,
    };
  }

  it("folds a burst of writes into one rebuild, after the writes go quiet", async () => {
    const ticking = clock();
    let rebuilt = 0;
    const scheduler = backupScheduler({
      rebuild: async () => {
        rebuilt += 1;
      },
      delay: 100,
      setTimer: ticking.setTimer,
      clearTimer: ticking.clearTimer,
    });
    // The bubble's chain: the automatic keep, the save, the deletion of the
    // scaffolding - three writes within the delay.
    scheduler.schedule();
    await ticking.tick(60);
    scheduler.schedule();
    await ticking.tick(60);
    scheduler.schedule();
    assert.equal(rebuilt, 0, "a rebuild ran before the writes went quiet");
    assert.equal(scheduler.pending(), true);
    await ticking.tick(100);
    assert.equal(rebuilt, 1, "a burst is rebuilt once");
    assert.equal(scheduler.pending(), false);
    assert.equal(ticking.armed(), 0, "a timer was left behind");
  });

  it("runs one rebuild at a time, in order, and a failure is nobody's error", async () => {
    /** @type {string[]} */
    const log = [];
    /** @type {(() => void)[]} */
    const releases = [];
    let calls = 0;
    const ticking = clock();
    const scheduler = backupScheduler({
      rebuild: () => {
        calls += 1;
        const mine = calls;
        log.push(`start ${mine}`);
        // The first rebuild is still reading when the second is due.
        if (mine === 1) {
          return new Promise((resolve) => {
            releases.push(() => {
              log.push("end 1");
              resolve(undefined);
            });
          });
        }
        if (mine === 2) {
          log.push("fail 2");
          return Promise.reject(new Error("the store would not open"));
        }
        log.push(`end ${mine}`);
        return Promise.resolve();
      },
      delay: 10,
      setTimer: ticking.setTimer,
      clearTimer: ticking.clearTimer,
    });
    scheduler.schedule();
    await ticking.tick(10);
    scheduler.schedule();
    await ticking.tick(10);
    assert.deepEqual(log, ["start 1"], "the second rebuild started under the first");
    releases[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(log, ["start 1", "end 1", "start 2", "fail 2"], "the rebuilds did not run in order");
    // The next write schedules again, and the failure before it is forgotten.
    scheduler.schedule();
    await ticking.tick(10);
    assert.deepEqual(log, ["start 1", "end 1", "start 2", "fail 2", "start 3", "end 3"]);
  });

  it("flushes a scheduled rebuild at once, and waits for the one in flight", async () => {
    const ticking = clock();
    let rebuilt = 0;
    const scheduler = backupScheduler({
      rebuild: async () => {
        rebuilt += 1;
      },
      delay: 100,
      setTimer: ticking.setTimer,
      clearTimer: ticking.clearTimer,
    });
    await scheduler.flush();
    assert.equal(rebuilt, 0, "a flush with nothing scheduled rebuilt");
    scheduler.schedule();
    await scheduler.flush();
    assert.equal(rebuilt, 1, "the flush did not run the scheduled rebuild");
    assert.equal(ticking.armed(), 0, "the flushed timer was left to fire again");
    await ticking.tick(200);
    assert.equal(rebuilt, 1, "the flushed timer fired again");
  });

  it("waits long enough to fold a page's burst and short enough for an idle event page", () => {
    // An event page is put down after thirty seconds of quiet; the timer
    // has to fire well inside that, in the same life as the write.
    assert.ok(BACKUP_DELAY_MS >= 1000 && BACKUP_DELAY_MS <= 5000, `${BACKUP_DELAY_MS} ms`);
  });
});
