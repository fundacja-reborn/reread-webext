/**
 * Where a document came from, as the reader page says it: the one rule for
 * whether a stored address may be a link at all, shared by the menu's "Open
 * the original" row, the orphan quotes' door (D150) and the site under the
 * title (D232) - and the name that line shows. Pure, so the rule is under
 * `node --test` and the three places can never disagree.
 */

/**
 * Whether a stored address is one a browser may open in a tab: only the
 * web's two schemes belong in an `href` this page hands out (D171). A
 * book's id is no address, a `file:` page cannot be opened from here
 * anyway, and anything stranger has no business being a link.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function webAddress(address) {
  try {
    const protocol = new URL(address).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The site a document came from, for the line under its title: the host
 * of a web address, exactly as the list row says it (`savedArticle` keeps
 * the same `hostname`, `www.` and all, so the two never name one site two
 * ways), and the address itself for the link - unchanged, the way the
 * menu's row carries it. Nothing where there is no site to name: a book,
 * a `file:` page, an address that is not one.
 *
 * @param {string | null} address
 * @returns {{ host: string, href: string } | null}
 */
export function sourceOf(address) {
  if (address === null || !webAddress(address)) return null;
  const host = new URL(address).hostname;
  return host.length > 0 ? { host, href: address } : null;
}
