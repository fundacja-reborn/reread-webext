/**
 * The addresses the extension's own pages send a reader to, each written
 * once, so that the day one moves, it moves here. Links the reader follows,
 * never requests the extension makes: nothing in this module fetches, and
 * every link shows the address it opens, so that the reader can tell where a
 * press leads before pressing (D192).
 *
 * Two of them. The answer on the re/read page that lists the dictionary
 * sources we know of, each with its licence - the settings page links it
 * twice and the bubble once (D192); the page exists in two languages, and a
 * Polish interface is sent to the Polish one. And the review page of the
 * store this browser installed re/read from (D290).
 */

/** The English page, and the one every interface but Polish opens. */
const SOURCES_PAGE = "https://reapps.eu/read#faq-dictionary-sources";

/** The Polish page, for a Polish interface. */
const SOURCES_PAGE_PL = "https://reapps.eu/pl/read#faq-dictionary-sources";

/**
 * @param {string} locale the interface language, as `uiLocale` names it
 * @returns {{ href: string, label: string }} the address and the words a link
 *   to it shows - the page's own name, without scheme or anchor, so that the
 *   reader can tell where a press leads before pressing
 */
export function dictionarySourcesLink(locale) {
  const polish = locale.toLowerCase().startsWith("pl");
  return {
    href: polish ? SOURCES_PAGE_PL : SOURCES_PAGE,
    label: polish ? "reapps.eu/pl/read" : "reapps.eu/read",
  };
}

/**
 * The review page of each store re/read is listed in, by the scheme the
 * browser gives the extension's own pages: `moz-extension:` is Firefox, on
 * desktop and on Android, and its add-ons site; `chrome-extension:` is every
 * Chromium - Chrome, Brave and Edge all install from the Chrome Web Store.
 * Safari's `safari-web-extension:` is absent on purpose: there is no App
 * Store listing to point at yet (M6), and a door to nowhere is worse than
 * none. The README's Support section names the same two addresses - a test
 * keeps the two in step.
 */
const STORE_REVIEWS = new Map([
  ["moz-extension:", "https://addons.mozilla.org/firefox/addon/reread/reviews/"],
  ["chrome-extension:", "https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla/reviews"],
]);

/**
 * @param {string} scheme the scheme of the extension's own page, as
 *   `location.protocol` gives it, colon included
 * @returns {{ href: string, label: string } | null} the review page and the
 *   words a link to it shows - the store's own address, without scheme or
 *   path - or null where the scheme names no store we are listed in
 */
export function storeReviewLink(scheme) {
  const href = STORE_REVIEWS.get(scheme);
  if (href === undefined) return null;
  return { href, label: new URL(href).host };
}
