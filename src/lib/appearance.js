/**
 * The chosen look of the extension's own pages (D104), applied where each page
 * reads it. The theme is the PAPER: every page of the extension wears it,
 * settings and popup included, so walking between pages never flashes a
 * different surface. The typeface and the text size dress CONTENT - text
 * somebody actually reads in the language being learned: the article, the
 * reading list's titles, the saved phrases. Interface stays interface
 * everywhere. Measure and links never leave the reader page - they are about
 * an article's column, and only the reader has one.
 *
 * The names of the root attributes and the custom property live here and
 * nowhere else; the palettes keyed on them live in `assets/page.css`. The
 * reader page applies its two extra knobs on top in its own `applyAppearance`,
 * which calls into this module for the shared part.
 *
 * `root` is structural - anything with `dataset` and `style.setProperty` - so
 * the rules run under `node --test` without a browser.
 */

import { webext } from "./browser.js";
import { CONFIG_KEY, readConfig } from "./config.js";

/**
 * @typedef {{
 *   dataset: Record<string, string | undefined>,
 *   style: { setProperty(name: string, value: string): void },
 * }} RootLike
 */

/**
 * The paper: the theme attribute the palettes in page.css key on. `auto` is
 * stamped too - it matches no palette, which is exactly what it means: the
 * browser's own scheme answers.
 *
 * @param {RootLike} root
 * @param {import("./config.js").ReaderConfig["theme"]} theme
 */
export function applyTheme(root, theme) {
  root.dataset["readerTheme"] = theme;
}

/**
 * The content dress: paper plus typeface and text size, for pages whose rows
 * hold text being read (the reader itself, the saved phrases).
 *
 * The typeface is two hands on one property: the serif/sans attribute picks
 * which preset stack `--reader-font-stack` holds, and a typed font name
 * (mobileread request) rides in front of it through `--reader-font-lead` -
 * always set, so the stylesheets can say `var(--reader-font-lead)` and be
 * done. The name arrives clean from the config (quotes and control
 * characters already out), so quoting it here is just quoting.
 *
 * @param {RootLike} root
 * @param {import("./config.js").ReaderConfig} reader
 */
export function applyReading(root, reader) {
  applyTheme(root, reader.theme);
  root.dataset["readerFont"] = reader.font;
  root.style.setProperty("--reader-size", `${reader.fontSize}px`);
  const stack = "var(--reader-font-stack)";
  root.style.setProperty(
    "--reader-font-lead",
    reader.fontFamily.length > 0 ? `"${reader.fontFamily}", ${stack}` : stack,
  );
}

/**
 * Dresses a page in the theme and keeps it dressed: read once now, follow
 * `storage.onChanged` after - the road every page already rides for its
 * settings. For the pages that are all interface (settings, popup); pages
 * with content of their own adopt the whole config themselves and call
 * `applyReading` from it.
 */
export function followTheme() {
  const root = document.documentElement;
  const apply = () => void readConfig().then((config) => applyTheme(root, config.reader.theme));
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || changes[CONFIG_KEY] === undefined) return;
    apply();
  });
  apply();
}
