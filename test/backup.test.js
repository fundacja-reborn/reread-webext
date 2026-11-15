import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  BACKUP_BUCKETS,
  BACKUP_DELAY_MS,
  BACKUP_KEY,
  asHead,
  asWholeBackup,
  backupScheduler,
  bucketKey,
  bucketOf,
  ensureBackup,
  readBackupSummary,
  rebuildBackup,
  restoreVocabulary,
} from "../src/lib/store/backup.js";

/** @typedef {import("../src/lib/store/phrase.js").Phrase} Phrase */
/** @typedef {import("../src/lib/store/backup.js").BackupDeps} BackupDeps */

/**
 * The copy of the vocabulary that outlives the database, held to its rules:
 * written from a store that could be read and only where it changed (D297),
 * restored only into an empty store, never touching a row that exists. No
 * browser runs in CI - the store and the storage are stand-ins that
 * remember what was asked of them and in what order.
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
 * The copy as the versions before D297 wrote it: one value, every phrase.
 *
 * @param {Phrase[]} phrases
 * @param {number} writtenAt
 */
function whole(phrases, writtenAt) {
  return { version: 1, writtenAt, phrases };
}

/** @param {Phrase[]} rows */
function byId(rows) {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * @param {{ phrases?: Phrase[], listFails?: boolean, area?: Record<string, unknown>, putMissing?: (rows: Phrase[]) => { added: number, skipped: number } }} [script]
 */
function standIn(script = {}) {
  /** The store's rows; a test changes them between rebuilds. */
  const store = { phrases: script.phrases ?? [] };
  /** @type {Record<string, unknown>} */
  const area = { ...script.area };
  /** @type {string[]} */
  const asked = [];
  /** Every write, as the keys it carried. */
  /** @type {string[][]} */
  const writes = [];
  let now = 42;
  /** @type {BackupDeps} */
  const deps = {
    empty: async () => {
      asked.push("empty");
      return store.phrases.length === 0;
    },
    list: async () => {
      asked.push("list");
      if (script.listFails === true) throw new Error("the store would not open");
      return [...store.phrases];
    },
    putMissing: async (rows) => {
      asked.push(`putMissing ${rows.length}`);
      return script.putMissing === undefined ? { added: rows.length, skipped: 0 } : script.putMissing(rows);
    },
    read: async (keys) => {
      asked.push(keys.length === 1 && keys[0] === BACKUP_KEY ? "read head" : `read ${keys.length} buckets`);
      /** @type {Record<string, unknown>} */
      const found = {};
      // Through JSON, as the storage area hands values back: its own copies.
      for (const key of keys) if (area[key] !== undefined) found[key] = JSON.parse(JSON.stringify(area[key]));
      return found;
    },
    write: async (items) => {
      asked.push("write");
      writes.push(Object.keys(items));
      for (const [key, value] of Object.entries(items)) area[key] = JSON.parse(JSON.stringify(value));
    },
    now: () => now,
  };
  return {
    deps,
    store,
    area,
    asked,
    writes,
    /** The bucket keys written since the last call, without the head. */
    takeBuckets: () => writes.splice(0).flat().filter((key) => key !== BACKUP_KEY),
    /** @param {number} at */
    setNow: (at) => {
      now = at;
    },
  };
}

/** A few dozen rows with ids shaped like the store's own. */
function manyPhrases(count = 200) {
  /** @type {Phrase[]} */
  const rows = [];
  for (let at = 0; at < count; at += 1) {
    const id = `${String(at * 2654435761).padStart(8, "0").slice(-8)}-0000-4000-8000-${String(at).padStart(12, "0")}`;
    rows.push(phrase(String(at), { id }));
  }
  return rows;
}

describe("the copy of the vocabulary", () => {
  it("comes back from its buckets with every field, the optional ones included", async () => {
    const rows = [
      phrase("1"),
      phrase("2", { langFrom: "de", context: "ein Satz", sourceUrl: "https://example.org/" }),
      phrase("3", { recallCount: 3, lastRecallAt: 50, readCount: 12, lastReadAt: 60, learnedAt: 5000 }),
    ];
    const world = standIn({ phrases: rows });
    assert.equal(await rebuildBackup(world.deps), 3);

    /** @type {Phrase[]} */
    let restored = [];
    const wiped = standIn({ area: world.area, putMissing: (back) => ((restored = back), { added: back.length, skipped: 0 }) });
    assert.equal(await restoreVocabulary(wiped.deps), 3);
    assert.deepEqual(byId(restored), byId(rows));
  });

  it("carries the counts (D209) as counts, and restores a phrase without a count that is not one", () => {
    const counted = phrase("1", { recallCount: 3, lastRecallAt: 50, readCount: 12, lastReadAt: 60 });
    assert.deepEqual(asWholeBackup(JSON.parse(JSON.stringify(whole([counted], 42))))?.phrases, [counted]);

    const narrowed = asWholeBackup({
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
    assert.deepEqual(asWholeBackup(JSON.parse(JSON.stringify(whole([marked], 42))))?.phrases, [marked]);
    const narrowed = asWholeBackup({
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

  it("is no copy at all in another shape, and drops the rows that make no sense", async () => {
    assert.equal(asWholeBackup(undefined), null);
    assert.equal(asWholeBackup(null), null);
    assert.equal(asWholeBackup({ version: 2, writtenAt: 1, phrases: [] }), null);
    assert.equal(asWholeBackup({ version: 1, writtenAt: "yesterday", phrases: [] }), null);
    assert.equal(asWholeBackup({ version: 1, writtenAt: 1 }), null);

    const digests = Array.from({ length: BACKUP_BUCKETS }, () => "0-0");
    const head = { version: 2, writtenAt: 1, count: 0, bytes: 0, digests, cursor: 3 };
    assert.deepEqual(asHead(head), head);
    assert.equal(asHead(undefined), null);
    assert.equal(asHead(whole([], 1)), null, "the whole copy of the versions before is not a head");
    assert.equal(asHead({ ...head, version: 3 }), null);
    assert.equal(asHead({ ...head, writtenAt: "yesterday" }), null);
    assert.equal(asHead({ ...head, count: -1 }), null);
    assert.equal(asHead({ ...head, digests: digests.slice(1) }), null, "a head for another number of buckets");
    assert.equal(asHead({ ...head, digests: digests.map(() => 7) }), null);
    assert.equal(asHead({ ...head, cursor: BACKUP_BUCKETS })?.cursor, 0, "a cursor past the buckets starts the round again");
    assert.equal(asHead({ ...head, cursor: "next" })?.cursor, 0);

    // A bucket's rows are narrowed one by one on the way back.
    const kept = phrase("1");
    const world = standIn({ phrases: [kept, phrase("5")] });
    await rebuildBackup(world.deps);
    const key = bucketKey(bucketOf("5"));
    world.area[key] = [
      .../** @type {unknown[]} */ (world.area[key]).map((row) => ({ .../** @type {object} */ (row), extra: "field" })),
      { ...phrase("2"), translations: [] },
      { ...phrase("3"), id: "" },
      { ...phrase("4"), createdAt: "then" },
      "not a row",
    ];
    /** @type {Phrase[]} */
    let restored = [];
    const wiped = standIn({ area: world.area, putMissing: (back) => ((restored = back), { added: back.length, skipped: 0 }) });
    await restoreVocabulary(wiped.deps);
    assert.deepEqual(byId(restored), [kept, phrase("5")], "the good rows, without the unknown field");
  });

  it("restores only into an empty store, and asks the store before it reads the copy", async () => {
    const full = standIn({ phrases: [phrase("1"), phrase("2"), phrase("3")] });
    await rebuildBackup(full.deps);

    const wiped = standIn({ area: full.area });
    assert.equal(await restoreVocabulary(wiped.deps), 3);
    assert.deepEqual(wiped.asked, ["empty", "read head", `read ${BACKUP_BUCKETS} buckets`, "putMissing 3"]);

    const standing = standIn({ phrases: [phrase("9")], area: full.area });
    assert.equal(await restoreVocabulary(standing.deps), 0);
    assert.deepEqual(standing.asked, ["empty"], "a store with phrases must not even cost the copy's read");
  });

  it("brings nothing back from no copy, an empty copy, or a copy of rows that already exist", async () => {
    const none = standIn();
    assert.equal(await restoreVocabulary(none.deps), 0);
    assert.deepEqual(none.asked, ["empty", "read head"], "no head, and the buckets were read anyway");

    // A deliberate emptying leaves an empty copy: the rebuild after it
    // writes every bucket that held a phrase as an empty one.
    const emptied = standIn({ phrases: [phrase("1"), phrase("2")] });
    await rebuildBackup(emptied.deps);
    emptied.store.phrases = [];
    await rebuildBackup(emptied.deps);
    assert.equal(asHead(emptied.area[BACKUP_KEY])?.count, 0);
    assert.equal(await restoreVocabulary(standIn({ area: emptied.area }).deps), 0);

    const copied = standIn({ phrases: [phrase("1"), phrase("2")] });
    await rebuildBackup(copied.deps);
    const skipped = standIn({ area: copied.area, putMissing: () => ({ added: 1, skipped: 1 }) });
    assert.equal(await restoreVocabulary(skipped.deps), 1, "only what was actually added counts as restored");
  });

  it("is first written whole from the store, the buckets before the head, and not at all from a store that would not answer", async () => {
    const rows = manyPhrases();
    const fine = standIn({ phrases: rows });
    assert.equal(await rebuildBackup(fine.deps), rows.length);
    assert.deepEqual(fine.asked, ["list", "read head", "write", "write"]);
    assert.equal(fine.writes[0]?.length, BACKUP_BUCKETS, "the first rebuild leaves a bucket unwritten");
    assert.deepEqual(fine.writes[1], [BACKUP_KEY], "the head is not the last write");
    const head = asHead(fine.area[BACKUP_KEY]);
    assert.equal(head?.count, rows.length);
    assert.equal(head?.writtenAt, 42);
    assert.equal(head?.cursor, 0);

    const broken = standIn({ phrases: rows, listFails: true });
    await assert.rejects(() => rebuildBackup(broken.deps));
    assert.deepEqual(broken.writes, [], "a copy replaced by a guess");
    assert.deepEqual(broken.asked, ["list"]);
  });

  it("writes one bucket for one phrase saved, changed, learned or deleted - and the bucket whose turn it is (D297)", async () => {
    const rows = manyPhrases();
    const world = standIn({ phrases: rows });
    await rebuildBackup(world.deps);
    world.takeBuckets();

    // Bucket 0's turn comes first; a phrase outside it shows both writes.
    const fresh = phrase("900", { id: "ffffffff-0000-4000-8000-000000000900" });
    assert.notEqual(bucketOf(fresh.id), 0);
    world.store.phrases = [...rows, fresh];
    await rebuildBackup(world.deps);
    assert.deepEqual(world.takeBuckets().sort(), [bucketKey(0), bucketKey(bucketOf(fresh.id))].sort(), "a save");

    // The turn moves on by one with every rebuild.
    world.store.phrases = [...rows, { ...fresh, translations: ["inne"] }];
    await rebuildBackup(world.deps);
    assert.deepEqual(world.takeBuckets().sort(), [bucketKey(1), bucketKey(bucketOf(fresh.id))].sort(), "other meanings");

    world.store.phrases = [...rows, { ...fresh, translations: ["inne"], learnedAt: 77 }];
    await rebuildBackup(world.deps);
    assert.deepEqual(world.takeBuckets().sort(), [bucketKey(2), bucketKey(bucketOf(fresh.id))].sort(), "learned");

    world.store.phrases = rows;
    await rebuildBackup(world.deps);
    assert.deepEqual(world.takeBuckets().sort(), [bucketKey(3), bucketKey(bucketOf(fresh.id))].sort(), "deleted");

    // And the copy is the store, whatever road it took there.
    /** @type {Phrase[]} */
    let restored = [];
    const wiped = standIn({ area: world.area, putMissing: (back) => ((restored = back), { added: back.length, skipped: 0 }) });
    await restoreVocabulary(wiped.deps);
    assert.deepEqual(byId(restored), byId(rows));
  });

  it("does not rewrite the copy for counts, and catches them up a bucket per rebuild", async () => {
    const rows = manyPhrases();
    const world = standIn({ phrases: rows });
    await rebuildBackup(world.deps);
    world.takeBuckets();

    // A finished part of a book: a read added to every row at once.
    const counted = rows.map((row) => ({ ...row, readCount: 4, lastReadAt: 900 }));
    world.store.phrases = counted;
    await rebuildBackup(world.deps);
    assert.deepEqual(world.takeBuckets(), [bucketKey(0)], "counts alone rewrote more than the bucket whose turn it was");

    // One full round later every bucket has had its turn.
    for (let turn = 1; turn < BACKUP_BUCKETS; turn += 1) await rebuildBackup(world.deps);
    assert.equal(new Set(world.takeBuckets()).size, BACKUP_BUCKETS - 1);
    /** @type {Phrase[]} */
    let restored = [];
    const wiped = standIn({ area: world.area, putMissing: (back) => ((restored = back), { added: back.length, skipped: 0 }) });
    await restoreVocabulary(wiped.deps);
    assert.deepEqual(byId(restored), byId(counted), "a count stayed behind after a full round");
  });

  it("takes its digest over every field of a phrase but the counts", async () => {
    const source = await readFile(new URL("../src/lib/store/backup.js", import.meta.url), "utf8");
    const narrowed = /function asPhrase\(row\) \{[\s\S]*?const \{([\s\S]*?)\} =/.exec(source)?.[1] ?? "";
    const fields = narrowed.split(",").map((one) => one.trim()).filter((one) => one.length > 0);
    const digested = /const DIGESTED = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
    const listed = [...digested.matchAll(/"([^"]+)"/g)].map((found) => found[1]);
    const counts = ["recallCount", "lastRecallAt", "readCount", "lastReadAt"];
    assert.ok(fields.length > 0 && listed.length > 0, "the lists were not found in the source");
    assert.deepEqual([...listed, ...counts].sort(), [...fields].sort(), "a field of a phrase is neither digested nor a count");
  });

  it("deals ids into every bucket, evenly enough", () => {
    const rows = manyPhrases(BACKUP_BUCKETS * 80);
    const sizes = Array.from({ length: BACKUP_BUCKETS }, () => 0);
    for (const row of rows) {
      const bucket = bucketOf(row.id);
      assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < BACKUP_BUCKETS);
      sizes[bucket] = (sizes[bucket] ?? 0) + 1;
    }
    assert.ok(Math.min(...sizes) > 0, "a bucket nothing lands in");
    assert.ok(Math.max(...sizes) < 80 * 2, `a bucket twice the size of the average: ${Math.max(...sizes)}`);
  });

  it("reads the whole copy of the versions before, restores from it, and replaces it at the first rebuild", async () => {
    const rows = [phrase("1"), phrase("2"), phrase("3")];
    const wiped = standIn({ area: { [BACKUP_KEY]: whole(rows, 7) } });
    assert.equal(await restoreVocabulary(wiped.deps), 3);
    assert.deepEqual(wiped.asked, ["empty", "read head", "putMissing 3"], "the old copy is one read");

    // The first start after the update: the store has its phrases, the copy
    // is the old one, and the look writes it again in buckets.
    const updated = standIn({ phrases: rows, area: { [BACKUP_KEY]: whole(rows, 7) } });
    assert.equal(await ensureBackup(updated.deps), true);
    assert.equal(asHead(updated.area[BACKUP_KEY])?.count, 3);
    assert.equal(asWholeBackup(updated.area[BACKUP_KEY]), null, "the old copy still stands under the head's key");
    assert.equal(updated.writes[0]?.length, BACKUP_BUCKETS);

    // The old copy beside an empty store is what a restore reads - never
    // written over from nothing.
    const evicted = standIn({ area: { [BACKUP_KEY]: whole(rows, 7) } });
    assert.equal(await ensureBackup(evicted.deps), false);
    assert.deepEqual(evicted.writes, []);
  });

  it("is written once for a vocabulary that has none, and left alone otherwise", async () => {
    const before = standIn({ phrases: [phrase("1")] });
    assert.equal(await ensureBackup(before.deps), true);
    assert.equal(asHead(before.area[BACKUP_KEY])?.count, 1);

    const already = standIn({ phrases: [phrase("1")], area: before.area });
    assert.equal(await ensureBackup(already.deps), false);
    assert.deepEqual(already.asked, ["read head"], "a copy that stands cost more than its head");
    assert.deepEqual(already.writes, []);

    const nothing = standIn();
    assert.equal(await ensureBackup(nothing.deps), false, "an empty store has nothing to copy");
    assert.deepEqual(nothing.writes, []);
  });

  it("tells the settings page how many phrases the copy holds, since when and what it weighs - off the head", async () => {
    assert.equal(await readBackupSummary(standIn().deps), null);

    const world = standIn({ phrases: [phrase("1"), phrase("2")] });
    world.setNow(9);
    await rebuildBackup(world.deps);
    const reading = standIn({ area: world.area });
    const summary = await readBackupSummary(reading.deps);
    assert.equal(summary?.count, 2);
    assert.equal(summary?.writtenAt, 9);
    assert.ok((summary?.bytes ?? 0) > 0, "the copy weighs nothing");
    assert.deepEqual(reading.asked, ["read head"], "the line on the settings page read a bucket");

    // The old whole copy is weighed as it was.
    const old = await readBackupSummary(standIn({ area: { [BACKUP_KEY]: whole([phrase("1")], 5) } }).deps);
    assert.equal(old?.count, 1);
    assert.equal(old?.writtenAt, 5);
    assert.ok((old?.bytes ?? 0) > 0);
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
