/**
 * The bar's full-screen tool (D195), in the bar of every page of this
 * extension since D220 - the reader in all of its views, the saved phrases,
 * the settings: one press asks the browser for the whole screen (Firefox for
 * Android folds its address bar, Android its status bar, a desktop browser
 * its whole frame), and the same press in full screen gives them back, as
 * Back or Esc does. Nothing else: until D220 the press over an article also
 * folded the reader's bar behind its ribbon, and Michał asked for the bar
 * to stay - it is what is stuck over every page now (D219), and a full
 * screen is about the browser's bars, not ours. The ribbon keeps folding
 * the reader's bar on its own.
 *
 * Offered where the browser has a full screen to give and the row has room
 * for it - on every platform since D220 (Michał's question: a laptop reads
 * too, and the menu's row has answered there since D180); until then Android
 * alone, the scope of the first ask. The room is measured, not assumed: the
 * tool is stood in the row and the row asked whether it now runs past its
 * edge, because the row's width in CSS pixels is the browser's business, not
 * the screen's - Firefox's font-size setting on Android is a whole-page
 * zoom, so a Boox with room to spare reported a narrower row than a fixed
 * breakpoint allowed for (Michał's photo, 2026-09-11), and a Pixel held
 * upright has none. Asked again on every resize, an orientation turned
 * included, and whenever another resident of the row comes or goes: the
 * reader's pen and speaker with the article, the back arrow of the settings
 * and the phrases once the page knows there is somewhere behind. A row that
 * is not laid out - the reader's bar folded behind its ribbon - has no
 * width to ask about; the reader asks again when it unfolds.
 *
 * Its name follows the browser's state - a glyph has no second label a
 * stylesheet could show; the glyph is the stylesheet's (`:root:fullscreen`,
 * page.css), and it is the whole of the tool's state: no lit frame, no
 * wash - the corners turned inward say it, and a bar lit for the whole of
 * a reading in full screen said nothing (Michał's photo, 2026-09-14).
 */

import { t } from "./i18n.js";

/**
 * What the page asks of a screen with a cutout in it - a notch, or the
 * lens punched through the panel - and it asks it only while it has the
 * whole screen (D269): `viewport-fit=cover` says "lay me out under it,
 * and tell me how much you took", which is what `env(safe-area-inset-top)`
 * then answers for the stylesheet's `--safe-top` (page.css).
 *
 * Asked for the duration of the full screen rather than written into the
 * pages' markup, because the declaration is not only ours: Firefox for
 * Android hands a page's `viewport-fit` to the whole browser window
 * (`GeckoEngineSession.onMetaViewportFitChange` maps it onto the
 * activity's display-cutout mode), so a page that wore `cover` in a tab
 * would be laying the browser's own bars under the lens for as long as it
 * was open. In full screen there are no bars left to lay anywhere.
 *
 * Gecko reports the inset without being asked (it reads the window's own
 * insets and hands them to CSS), so on Firefox the stylesheet alone is
 * enough; Chromium and WebKit report it only to a page that asked, which
 * is what this is for - the reader travels to Chromium-based browsers with
 * extensions and to iOS.
 */
function armViewportFit() {
  const meta = document.querySelector("meta[name=viewport]");
  if (!(meta instanceof HTMLMetaElement)) return;
  // What the page says in a tab, kept once: the sentence is the page's
  // own (the reader's carries `interactive-widget`, D118), and the ask is
  // added to it rather than replacing it.
  const inTab = meta.content;
  document.addEventListener("fullscreenchange", () => {
    meta.content = document.fullscreenElement === null ? inTab : `${inTab}, viewport-fit=cover`;
  });
}

/**
 * Wires a page's `#fullscreen` button, or does nothing on a page without
 * one. Called once, at load, by the reader, the saved phrases and the
 * settings. What comes back asks the room question again, for the one
 * change the tool cannot see for itself (the reader's bar unfolding).
 *
 * @param {HTMLElement | null} tool
 * @param {() => void} [closePanels] what to put away before the screen
 *   changes - the bar's open panel, on the pages that have one
 * @returns {() => void}
 */
export function armFullscreenTool(tool, closePanels) {
  // Before the tool, and whether or not there is one: the screen can be
  // entered from the reader's menu row and left with Back or Esc, and a
  // row too narrow for the tool still has a page that may be in it.
  armViewportFit();
  if (tool === null) return () => {};
  const bar = tool.closest(".page-bar");

  const update = () => {
    const offered = document.fullscreenEnabled === true;
    if (tool.hidden !== !offered) tool.hidden = !offered;
    if (offered && bar instanceof HTMLElement && bar.clientWidth > 0 && bar.scrollWidth > bar.clientWidth) {
      tool.hidden = true;
    }
    const label = document.fullscreenElement !== null ? t("reader_fullscreen_exit") : t("reader_fullscreen");
    tool.title = label;
    tool.setAttribute("aria-label", label);
  };

  tool.addEventListener("click", () => {
    closePanels?.();
    // The request rides the press's own activation - the only thing a
    // browser accepts it from. The root, not the body, so the fixed bars
    // keep their viewport. A request refused is the browser's word in its
    // own console, and nothing the page could add to.
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  // The name follows the state, entered by this press or the reader menu's
  // row and left by either, Back or Esc; the room follows the window.
  document.addEventListener("fullscreenchange", update);
  window.addEventListener("resize", update);
  if (bar instanceof HTMLElement) {
    // Another resident of the row shown or hidden changes the room. The
    // tool's own flips are this function's, and must not ask it again.
    new MutationObserver((records) => {
      if (records.some((record) => record.target !== tool)) update();
    }).observe(bar, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  }
  update();
  return update;
}
