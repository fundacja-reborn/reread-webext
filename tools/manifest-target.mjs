// How the one manifest becomes each browser's manifest.
//
// The manifest is written for Firefox, because Firefox is what the MVP targets.
// Chromium differs in a handful of places, and all of them are worth seeing
// side by side in one function rather than hidden in a second copy of the file
// that would drift. Its own module rather than a corner of `build.mjs` so the
// test suite can assert on the patched shape without running a build.

export const TARGETS = /** @type {const} */ (["firefox", "chromium"]);

/** @typedef {(typeof TARGETS)[number]} Target */

/**
 * The raster icons Chromium gets. Firefox reads the SVG mark and follows the
 * toolbar theme with it; Chromium has never accepted SVG for extension icons,
 * so it gets these, generated from the same drawing by
 * `tools/icon/make-icons.mjs`.
 */
export const CHROMIUM_ICONS = Object.freeze({
  16: "assets/icons/icon-16.png",
  32: "assets/icons/icon-32.png",
  48: "assets/icons/icon-48.png",
  128: "assets/icons/icon-128.png",
});

/**
 * The floor is set by `document.caretPositionFromPoint` (Chrome 128) - the one
 * call underline and touch hit-testing stand on. Everything else this
 * extension needs is older: promises from `chrome.*` (121), `offscreen` (109),
 * `runtime.getContexts` (116), nested workers are not used on Chromium at all.
 */
export const MINIMUM_CHROME_VERSION = "128";

/**
 * What each package carries beyond the shared files - exactly the icons its
 * manifest or its code names, because an unreferenced file in a package anyone
 * may audit is a question with no good answer, and a referenced file missing
 * from it is a console full of ERR_FILE_NOT_FOUND. Firefox reads the SVG mark
 * and its theme variants; Chromium gets the rasters, including the
 * dark-toolbar pair that only `action.setIcon` ever names (see
 * `src/lib/theme-icon.js` - the test suite holds the two lists together).
 *
 * Lives here rather than in `build.mjs` so tests can assert on it: importing
 * the build script would run a build.
 *
 * @type {Record<Target, string[]>}
 */
export const TARGET_STATIC_FILES = {
  firefox: [
    "assets/icons/icon.svg",
    "assets/icons/icon-dark.svg",
    "assets/icons/icon-light.svg",
  ],
  chromium: [
    "assets/icons/icon-16.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
    "assets/icons/icon-light-16.png",
    "assets/icons/icon-light-32.png",
    "offscreen/engine-host.html",
  ],
};

/**
 * @param {Record<string, unknown>} manifest
 * @param {Target} target
 * @returns {Record<string, unknown>}
 */
export function forTarget(manifest, target) {
  if (target === "firefox") return manifest;

  const patched = { ...manifest };
  // Gecko-only: extension id, minimum version, data collection disclosure.
  delete patched["browser_specific_settings"];
  patched["minimum_chrome_version"] = MINIMUM_CHROME_VERSION;
  // Firefox MV3 runs an event page; Chromium runs a service worker. A service
  // worker cannot spawn the engine's worker (the spec forbids nested workers),
  // so on Chromium the engine lives in an offscreen document - which is what
  // the one extra permission is for.
  patched["background"] = { service_worker: "background/index.js" };
  patched["permissions"] = [
    .../** @type {string[]} */ (manifest["permissions"] ?? []),
    "offscreen",
  ];
  patched["icons"] = { ...CHROMIUM_ICONS };
  // Gecko-only: theme-aware toolbar icon variants. Chromium flags the key.
  const action = { .../** @type {Record<string, unknown>} */ (patched["action"]) };
  delete action["theme_icons"];
  action["default_icon"] = { 16: CHROMIUM_ICONS[16], 32: CHROMIUM_ICONS[32] };
  patched["action"] = action;
  return patched;
}
