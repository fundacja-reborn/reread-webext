// Builds the loadable extension from `src/` into `dist/<target>/`.
//
// There is a bundler here for exactly one reason: content scripts cannot be ES
// modules in either browser, so the imports have to be resolved before the
// browser sees the file. Everything else follows from keeping the output
// auditable - no minification, no transpiling down, one file per entry point,
// and a source map that carries its own sources so devtools can show the code
// as it was written.
//
// Usage:
//   node tools/build.mjs [--target=firefox|chromium] [--watch]

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** Entry points, relative to `src/`. Each becomes one bundled file in `dist/`. */
const ENTRY_POINTS = [
  "background/index.js",
  "background/engine.worker.js",
  "content/index.js",
  "options/options.js",
  "popup/index.js",
  "reader/reader.js",
  "vocab/vocab.js",
];

/**
 * Copied through untouched, relative to `src/`. The highlight stylesheet is
 * here rather than in a bundle on purpose: it is what the extension does to
 * somebody else's page, and it should be readable as one short file.
 */
const STATIC_FILES = [
  "options/options.html",
  "options/options.css",
  "popup/index.html",
  "popup/popup.css",
  "reader/reader.html",
  "reader/reader.css",
  "vocab/vocab.html",
  "vocab/vocab.css",
  "content/highlight.css",
  "assets",
  "_locales",
];

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
const VENDOR_FILES = [
  "vendor/bergamot/bergamot-translator-worker.js",
  "vendor/bergamot/bergamot-translator-worker.wasm",
  "vendor/bergamot/LICENSE",
  "vendor/bergamot/README.md",
  "vendor/readability/Readability.js",
  "vendor/readability/LICENSE",
  "vendor/readability/README.md",
];

const TARGETS = /** @type {const} */ (["firefox", "chromium"]);

/** @typedef {(typeof TARGETS)[number]} Target */

/**
 * The manifest is written for Firefox, because Firefox is what the MVP targets.
 * Chromium differs in exactly three places, and all are worth seeing side by
 * side rather than hidden in a second copy of the file that would drift.
 *
 * @param {Record<string, unknown>} manifest
 * @param {Target} target
 * @returns {Record<string, unknown>}
 */
function forTarget(manifest, target) {
  if (target === "firefox") return manifest;

  const patched = { ...manifest };
  // Gecko-only: extension id, minimum version, data collection disclosure.
  delete patched["browser_specific_settings"];
  // Firefox MV3 runs an event page; Chromium runs a service worker.
  patched["background"] = { service_worker: "background/index.js" };
  // Gecko-only: theme-aware toolbar icon variants. Chromium flags the key.
  const action = { .../** @type {Record<string, unknown>} */ (patched["action"]) };
  delete action["theme_icons"];
  patched["action"] = action;
  return patched;
}

/**
 * @param {Target} target
 * @param {boolean} watch
 */
async function build(target, watch) {
  const out = join(ROOT, "dist", target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  /** @type {esbuild.BuildOptions} */
  const options = {
    entryPoints: ENTRY_POINTS.map((entry) => join(SRC, entry)),
    outdir: out,
    outbase: SRC,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: target === "firefox" ? ["firefox140"] : ["chrome120"],
    // Readable output is a requirement, not a preference: an extension asking
    // for `<all_urls>` should be one anybody can read before trusting it.
    minify: false,
    sourcemap: true,
    sourcesContent: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
  };

  const copyStatic = async () => {
    for (const file of STATIC_FILES) {
      await cp(join(SRC, file), join(out, file), { recursive: true });
    }
    for (const file of VENDOR_FILES) {
      await mkdir(dirname(join(out, file)), { recursive: true });
      await cp(join(ROOT, file), join(out, file));
    }
    const manifest = JSON.parse(await readFile(join(SRC, "manifest.json"), "utf8"));
    await writeFile(
      join(out, "manifest.json"),
      JSON.stringify(forTarget(manifest, target), null, 2) + "\n",
    );
  };

  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    await copyStatic();
    console.log(`[build] watching, output in dist/${target}`);
    return;
  }

  await esbuild.build(options);
  await copyStatic();

  if (target === "chromium") {
    // Chromium has never accepted SVG for extension icons. Rasterizing them is
    // part of the Chromium port, not of a build that would otherwise pretend to
    // have produced something loadable.
    console.warn("[build] chromium: icons are SVG and Chromium ignores them - see M5 in the docs");
  }
  console.log(`[build] ${target} -> dist/${target}`);
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const targetArg = args.find((arg) => arg.startsWith("--target="))?.split("=")[1] ?? "firefox";
if (!(/** @type {readonly string[]} */ (TARGETS).includes(targetArg))) {
  console.error(`[build] unknown target "${targetArg}" - expected one of: ${TARGETS.join(", ")}`);
  process.exit(2);
}

await build(/** @type {Target} */ (targetArg), watch);
