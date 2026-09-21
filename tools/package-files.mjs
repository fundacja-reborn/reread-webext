// The files the package carries as they are, by name.
//
// Every file here is copied into `dist/<target>/` untouched, next to the
// bundles esbuild writes. By name, and never a folder at a time: a copy of a
// folder takes what stands in the folder on the machine that builds, not what
// is in the repository. `_locales` used to be copied whole, and a hidden
// folder a tool had left beside the catalogues (`_locales/.claude/`, ignored by
// git) went into both store packages of a dry run before the 0.5.78 round. At
// run time it was harmless: Chromium passes over a name in `_locales` that
// begins with a dot (`GetValidLocales`). The defect is the package itself - a
// reviewer rebuilds it from the source archive, which is the tracked files and
// nothing else, and a package that cannot be rebuilt cannot be checked.
//
// Its own module rather than a corner of `build.mjs` so the test suite can hold
// these lists against `git ls-files`: importing the build script would run a
// build.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Copied through untouched, relative to `src/`. The highlight stylesheet is
 * here rather than in a bundle on purpose: it is what the extension does to
 * somebody else's page, and it should be readable as one short file.
 *
 * The catalogues are not in this list because nobody should have to remember
 * it when a language is added: `localeCatalogues` reads them off the folder.
 */
export const STATIC_FILES = Object.freeze([
  "options/options.html",
  "options/options.css",
  "popup/index.html",
  "popup/popup.css",
  "reader/reader.html",
  "reader/reader.css",
  "vocab/vocab.html",
  "vocab/vocab.css",
  "content/highlight.css",
  "assets/page.css",
]);

/**
 * Third-party code, relative to the repository root, copied in rather than
 * bundled. The licence and the note about where each came from travel with
 * them: MPL-2.0 and Apache-2.0 both ask for the first, and an unexplained
 * five-megabyte blob inside an extension is exactly what the second answers.
 *
 * Copied, not bundled, for a reason that outlives convenience: the file that
 * ships has to have the same SHA-256 as the file the upstream project
 * published, and anything esbuild touches no longer does.
 */
export const VENDOR_FILES = Object.freeze([
  "vendor/bergamot/bergamot-translator-worker.js",
  "vendor/bergamot/bergamot-translator-worker.wasm",
  "vendor/bergamot/LICENSE",
  "vendor/bergamot/README.md",
  "vendor/readability/Readability.js",
  "vendor/readability/LICENSE",
  "vendor/readability/README.md",
  "vendor/fflate/browser.js",
  "vendor/fflate/LICENSE",
  "vendor/fflate/README.md",
]);

/** The one file of a locale folder that a browser reads. */
const CATALOGUE = "messages.json";

/**
 * The catalogues, relative to `src/`: `messages.json` of every locale folder,
 * and nothing else that happens to stand in `_locales`.
 *
 * A name that begins with a dot is never a locale - a Finder's `.DS_Store`, a
 * tool's working folder - and is passed over, which is also what `web-ext`
 * does when it makes the signed package (`**` + `/.*` among its ignored
 * patterns). Anything else that is not a locale folder with a catalogue in it
 * stops the build: a folder of `_locales` is a language to the browser, and
 * Chromium refuses to load an extension in which the folder of a language it
 * knows has no catalogue ("Catalog file is missing for locale"). A build that
 * went on would find that out on somebody else's machine.
 *
 * @param {string} src  absolute path of `src/`
 * @returns {Promise<string[]>} sorted, so that two builds copy in one order
 */
export async function localeCatalogues(src) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(join(src, "_locales"), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) {
      throw new Error(`src/_locales/${entry.name} is not a locale folder`);
    }
    const file = join("_locales", entry.name, CATALOGUE);
    const found = await stat(join(src, file)).then(
      (stats) => stats.isFile(),
      () => false,
    );
    if (!found) throw new Error(`src/_locales/${entry.name} has no ${CATALOGUE}`);
    files.push(file);
  }
  return files.sort();
}
