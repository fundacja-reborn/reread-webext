import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

import { BACKUP_ENSURED_KEY, readBackupEnsured, writeBackupEnsured } from "../src/lib/session.js";

/**
 * The copy of the vocabulary off the save's path (D295): the background
 * answers a write once the mirror stands, and the copy that outlives the
 * database is rebuilt after the writes go quiet - and looked for, at the
 * background's start, once per browser session rather than at every start
 * of an event page. The scheduler has its own tests (`backup.test.js`);
 * this reads the call sites, the way the other wiring tests do, and runs
 * the session flag against a stand-in.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the copy of the vocabulary off the save's path (D295)", () => {
  it("rebuilds the mirror before a write answers, and schedules the copy", async () => {
    const background = await source("background/vocabulary.js");
    assert.match(background, /const backup = backupScheduler\(\{ rebuild: rebuildBackup \}\);/, "the copy has no scheduler");
    const after = bodyOf(background, "afterWrite");
    assert.match(after, /await rebuildMirror\(config\);\s*backup\.schedule\(\);/, "the write answers before the mirror stands, or waits for the copy");
    assert.doesNotMatch(after, /await rebuildBackup|await backup/, "the write waits for the copy");
    // No door rebuilds the copy inside its answer: the sentence a count
    // report fills in (D216) schedules it like every other write.
    const doors = background.slice(background.indexOf("export async function refreshVocabulary("));
    assert.doesNotMatch(doors, /await rebuildBackup\(\)/, "a door rebuilds the copy inside its answer");
    assert.match(bodyOf(background, "countPhrases"), /else if \(filled > 0\) backup\.schedule\(\);/, "a filled sentence waits for the copy, or never reaches it");
  });

  it("looks for a missing copy once per browser session, and at every start when the session store will not say", async () => {
    const background = await source("background/vocabulary.js");
    const once = bodyOf(background, "ensureBackupOnce");
    assert.match(once, /ensured = await readBackupEnsured\(\);/, "the flag is not read");
    assert.match(once, /catch \{\s*ensured = false;/, "a session store that will not answer skips the look");
    assert.match(once, /if \(ensured\) return;\s*await ensureBackup\(\);\s*await writeBackupEnsured\(\)\.catch\(\(\) => undefined\);/, "the look is not followed by the flag, or the flag's failure fails the start");
    // In the start's chain, where `ensureBackup` stood (D205's order).
    const started = background.slice(background.indexOf("const started = settled()"), background.indexOf("export async function refreshVocabulary("));
    assert.match(started, /await ensureBackupOnce\(\);/, "the start looks for the copy at every start");
    assert.doesNotMatch(started, /await ensureBackup\(\);/, "the start looks for the copy at every start");
  });

  it("keeps the flag in the session store, true or absent", async () => {
    /** @type {Record<string, unknown>} */
    const kept = {};
    const session = /** @type {WebExtBrowser["storage"]["session"]} */ ({
      get: async (/** @type {string} */ key) => ({ [key]: kept[key] }),
      set: async (/** @type {Record<string, unknown>} */ values) => {
        Object.assign(kept, values);
      },
      remove: async (/** @type {string} */ key) => {
        delete kept[key];
      },
    });
    assert.equal(await readBackupEnsured(session), false);
    await writeBackupEnsured(session);
    assert.equal(kept[BACKUP_ENSURED_KEY], true);
    assert.equal(await readBackupEnsured(session), true);
    // Anything but true is no flag: a hand-edited store, another version.
    kept[BACKUP_ENSURED_KEY] = "yes";
    assert.equal(await readBackupEnsured(session), false);
  });
});
