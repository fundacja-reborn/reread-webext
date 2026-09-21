import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TARGET_STATIC_FILES } from "../tools/manifest-target.mjs";
import { STATIC_FILES, VENDOR_FILES, localeCatalogues } from "../tools/package-files.mjs";

/**
 * What the build copies into the package as it is. The promise these tests
 * hold: the package is made of tracked files and of bundles made from tracked
 * files - so the package a reviewer rebuilds from the source archive is the
 * package that was sent. A folder copied whole breaks that without a sound: it
 * takes whatever stands in the folder on the machine that builds.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/** @returns {Set<string>} */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  return new Set(out.split("\n").filter(Boolean));
}

/** @type {string[]} */
const made = [];
after(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/**
 * A `src/` with a `_locales` of the given shape: a name ending in a slash is a
 * folder, anything else a file.
 *
 * @param {string[]} entries  relative to `_locales`
 * @returns {Promise<string>}
 */
async function srcWith(entries) {
  const src = await mkdtemp(join(tmpdir(), "reread-locales-"));
  made.push(src);
  await mkdir(join(src, "_locales"));
  for (const entry of entries) {
    const path = join(src, "_locales", entry);
    if (entry.endsWith("/")) {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "{}");
    }
  }
  return src;
}

describe("the files the build copies as they are", () => {
  it("are tracked files, every one - a folder or a file git does not know is neither", async () => {
    const tracked = trackedFiles();
    const copied = [
      ...STATIC_FILES.map((file) => `src/${file}`),
      ...Object.values(TARGET_STATIC_FILES).flatMap((files) => files.map((file) => `src/${file}`)),
      ...(await localeCatalogues(SRC)).map((file) => `src/${file}`),
      ...VENDOR_FILES,
    ];
    const strangers = copied.filter((file) => !tracked.has(file));
    assert.deepEqual(strangers, [], "the build copies something the source archive does not carry");
  });

  it("take from _locales what the repository holds there, no more and no less", async () => {
    const tracked = [...trackedFiles()].filter((file) => file.startsWith("src/_locales/")).sort();
    const copied = (await localeCatalogues(SRC)).map((file) => `src/${file}`);
    assert.deepEqual(copied, tracked);
  });
});

describe("the catalogues the build takes from _locales", () => {
  it("are messages.json of every locale folder, in one order", async () => {
    const src = await srcWith(["pl/messages.json", "en/messages.json", "de/messages.json"]);
    assert.deepEqual(await localeCatalogues(src), [
      join("_locales", "de", "messages.json"),
      join("_locales", "en", "messages.json"),
      join("_locales", "pl", "messages.json"),
    ]);
  });

  // What went into both store packages of a dry run before the 0.5.78 round: a
  // tool's hidden working folder beside the catalogues, ignored by git and so
  // invisible in `git status`.
  it("pass over a hidden folder and a hidden file, at both levels", async () => {
    const src = await srcWith([
      "en/messages.json",
      "en/.DS_Store",
      "en/.claude/.cc-writes/",
      ".claude/.cc-writes/",
      ".DS_Store",
    ]);
    assert.deepEqual(await localeCatalogues(src), [join("_locales", "en", "messages.json")]);
  });

  it("leave behind whatever else stands in a locale folder", async () => {
    const src = await srcWith(["en/messages.json", "en/messages.json.orig", "en/notes.txt"]);
    assert.deepEqual(await localeCatalogues(src), [join("_locales", "en", "messages.json")]);
  });

  it("stop the build at a locale folder with no catalogue in it", async () => {
    const src = await srcWith(["en/messages.json", "de/"]);
    await assert.rejects(localeCatalogues(src), /src\/_locales\/de has no messages\.json/);
  });

  it("stop the build at a file that stands where a locale folder should", async () => {
    const src = await srcWith(["en/messages.json", "README.md"]);
    await assert.rejects(localeCatalogues(src), /src\/_locales\/README\.md is not a locale folder/);
  });
});
