/**
 * The toolbar icon's answer to the toolbar's theme, where the browser has
 * none of its own.
 *
 * Firefox reads `action.theme_icons` from the manifest and swaps the icon
 * itself. Chrome has no manifest equivalent (`icon_variants` is a WECG
 * proposal nothing has shipped), so its package strips `theme_icons` and the
 * extension does the swapping with `action.setIcon` - and the stripped key is
 * also the switch this module runs on: a manifest that still carries
 * `theme_icons` names a browser that needs no help.
 *
 * Who calls what: every extension page (popup, settings, reader, vocabulary)
 * calls `watchToolbarScheme` on load and corrects the icon for as long as it
 * is open; the engine host reports the scheme to the background over its own
 * channel whenever it stands, and the background answers with
 * `toolbarIconFor` - which is how the icon is right at browser start and
 * after a translation, with no page open at all. A theme flipped while the
 * extension sits untouched is corrected at the next of any of these.
 */

import { webext } from "./browser.js";

/**
 * The two toolbar sets, by the scheme they serve. Only the action icon can
 * be swapped at runtime; what the manifest's `icons` key feeds - the
 * management page - stays the light-scheme default.
 */
const TOOLBAR_ICONS = Object.freeze({
  light: { 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png" },
  dark: { 16: "assets/icons/icon-light-16.png", 32: "assets/icons/icon-light-32.png" },
});

/**
 * @param {boolean} dark - whether the browser's color scheme is dark
 * @returns {Record<number, string>}
 */
export function toolbarIconFor(dark) {
  return TOOLBAR_ICONS[dark ? "dark" : "light"];
}

/**
 * Keeps the toolbar icon matched to the color scheme for as long as the
 * calling page lives. A no-op wherever the browser swaps icons itself.
 *
 * The failure mode of `setIcon` is somebody else's toolbar state, never this
 * page's work - hence the swallowed rejection.
 */
export function watchToolbarScheme() {
  const api = webext();
  const action = /** @type {{ theme_icons?: unknown } | undefined} */ (
    api.runtime.getManifest()["action"]
  );
  if (action?.theme_icons !== undefined) return;

  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    void api.action.setIcon({ path: toolbarIconFor(media.matches) }).catch(() => {});
  };
  apply();
  media.addEventListener("change", apply);
}
