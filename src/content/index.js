/**
 * What runs on every page the reader opens.
 *
 * Two things, and the first one is the whole of it: start the reading side
 * against this page. Everything about selections, the bubble, keeping a phrase
 * and underlining the ones already kept lives in `reading.js`, because the
 * reader page runs exactly the same code against the article it built (D42).
 *
 * The second is the one question the background ever asks a page, and it asks
 * only after somebody pressed the toolbar button on this tab. A message
 * listener costs nothing while nobody does: no timer, no observer, nothing
 * added to the page.
 */

import { webext } from "../lib/browser.js";
import { ErrorCode, MAX_PAGE_HTML, asPageRequest, fail, ok } from "../lib/protocol.js";
import { start } from "./reading.js";

// The whole body, and follow it: a page loads its own content, swaps articles
// under a router and edits text in place, and underlines have to keep up.
start({ root: document.body, observe: true });

// The document is serialized as it stands rather than re-downloaded, which is
// what makes the reader work behind a login and on a page built by scripts -
// and what keeps the promise that this extension makes no request of its own.
webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (asPageRequest(message) === null) return false;

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
