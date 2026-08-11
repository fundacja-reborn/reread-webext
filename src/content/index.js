/**
 * What runs on every page the reader opens.
 *
 * Three things. The first is the whole of it: start the reading side against
 * this page - unless this site has been switched off, in which case starting
 * is exactly what must not happen. Everything about selections, the bubble,
 * keeping a phrase and underlining the ones already kept lives in
 * `reading.js`, because the reader page runs exactly the same code against the
 * article it built (D42).
 *
 * The second is the switch itself. Whether this page runs is a line in the
 * settings, so the settings are what this listens to: the popup writes them,
 * the options page writes them, and every open tab of the site notices through
 * the same storage event - which matters, because neither of those pages could
 * address the tabs of one site without the `tabs` permission this extension
 * does not have. On a switched-off site the whole footprint is this listener
 * and the message listener below: no scan, no observer, nothing on the page.
 *
 * The third is the two questions a tab ever answers - the background asking
 * for the page after the reader was pointed here, and the popup asking which
 * site this is. A message listener costs nothing while nobody asks: no timer,
 * no observer, nothing added to the page. It stays on while the site is
 * switched off, and has to: it is also how the popup knows what to call this
 * site when offering to switch it back on.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, withDefaults } from "../lib/config.js";
import { ErrorCode, MAX_PAGE_HTML, Message, asPageRequest, fail, ok } from "../lib/protocol.js";
import { MIRROR_KEY } from "../lib/store/mirror.js";
import { start, stop } from "./reading.js";

let running = false;
/** Whether a settings change already decided, making the startup read stale. */
let decided = false;

/**
 * @param {unknown} config as stored, defaults not yet applied
 * @returns {boolean}
 */
function wantedHere(config) {
  return !withDefaults(config).disabledHosts.includes(location.hostname);
}

/**
 * @param {boolean} wanted
 * @param {Record<string, unknown>} [stored] the startup read, the one time there is one
 */
function apply(wanted, stored) {
  if (wanted === running) return;
  running = wanted;
  // The whole body, and follow it: a page loads its own content, swaps
  // articles under a router and edits text in place, and underlines have to
  // keep up.
  if (wanted) start({ root: document.body, observe: true, stored });
  else stop();
}

// One read of `storage.local` at startup, the same one `reading.js` would have
// made - it decides whether to start at all, and if so, feeds the start.
void webext()
  .storage.local.get([CONFIG_KEY, MIRROR_KEY])
  .then((stored) => {
    if (!decided) apply(wantedHere(stored[CONFIG_KEY]), stored);
  })
  .catch(() => {
    // Storage unreachable says nothing about this site being switched off, so
    // run: `reading.js` has its own answer to storage being broken.
    if (!decided) apply(true);
  });

webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const change = changes[CONFIG_KEY];
  if (change === undefined) return;
  decided = true;
  apply(wantedHere(change.newValue));
});

// The document is serialized as it stands rather than re-downloaded, which is
// what makes the reader work behind a login and on a page built by scripts -
// and what keeps the promise that this extension makes no request of its own.
webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = asPageRequest(message);
  if (request === null) return false;

  // Which site this is, said by the page itself: the popup has a tab id and no
  // address, because reading addresses is what the `tabs` permission is for.
  if (request.kind === Message.PAGE_INFO) {
    sendResponse(ok({ hostname: location.hostname }));
    return false;
  }

  const html = document.documentElement.outerHTML;
  // Answered on the spot, so `return false` rather than the usual `true`:
  // there is nothing to wait for, and claiming otherwise leaves the background
  // holding a promise nobody will settle.
  sendResponse(
    html.length > MAX_PAGE_HTML
      ? fail(ErrorCode.TOO_LONG)
      : ok({ url: location.href, title: document.title, html }),
  );
  return false;
});
