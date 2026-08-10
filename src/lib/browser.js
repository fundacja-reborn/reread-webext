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
