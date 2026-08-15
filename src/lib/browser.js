/**
 * The one place the extension API is reached for.
 *
 * Firefox exposes `browser` with promises; Chromium exposes `chrome`, which has
 * returned promises for these APIs since Chrome 121. That makes the whole
 * compatibility layer an alias, and an alias is worth more than a polyfill
 * here: `webextension-polyfill` is a thousand lines shipped inside an extension
 * whose selling point is that you can read it, and it exists for callback-era
 * Chrome that Manifest V3 already left behind.
 *
 * If a real gap turns up during the Chromium port, this module is where it gets
 * patched - nothing else in the codebase names `chrome`.
 *
 * A function rather than a constant, and without a cached reference: importing
 * a module must not depend on where it is imported, or the pure logic in
 * `config.js` could not be tested outside a browser.
 *
 * @returns {WebExtBrowser}
 */
export function webext() {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.id) {
    // Every context this loads in is an extension context. Failing here with a
    // sentence beats a member access on undefined three frames later.
    throw new Error("re/read: no WebExtension API in this context");
  }
  return api;
}

/**
 * The offscreen-document API, or null on a browser without one - and that
 * absence is the real Chromium difference this module exists to hold: on
 * Firefox the background is an event page that spawns the engine's worker
 * itself, on Chromium it is a service worker that cannot (the service worker
 * spec forbids nested workers), so the engine runs in an offscreen document
 * instead. Callers ask this one question and never which browser they are on.
 *
 * @returns {NonNullable<WebExtBrowser["offscreen"]> | null}
 */
export function offscreenApi() {
  return webext().offscreen ?? null;
}
