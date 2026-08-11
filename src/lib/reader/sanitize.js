/**
 * What of somebody else's HTML is allowed into the reader, decided without
 * touching a DOM so that it can be tested.
 *
 * This is the security boundary of the whole extension. The reader is an
 * extension page, and an extension page with `<all_urls>` running a script from
 * a website would be the worst thing that could happen in this codebase. Three
 * barriers stand in the way and each works on its own: the document is parsed
 * by `DOMParser`, which has no browsing context and runs nothing; the tree is
 * rebuilt from this list rather than assigned as `innerHTML`; and the manifest's
 * content security policy denies every remote resource.
 *
 * The list is an allow list, not a deny list. Anything nobody thought about
 * loses its element - never its text.
 */

/**
 * Elements copied as themselves: the shape of a text, and nothing that loads,
 * runs, submits or plays.
 */
const KEPT = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "q", "cite", "pre", "code", "kbd", "samp", "var",
  "em", "strong", "i", "b", "u", "s", "del", "ins", "small", "mark", "sub", "sup",
  "abbr", "time", "span", "div", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd",
  "figure", "figcaption", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a",
]);

/**
 * Elements dropped with everything inside them. Two kinds, and the second is
 * the reason this list is not simply "things that execute":
 *
 *   - anything that runs, loads or submits (`script`, `iframe`, `form`, ...),
 *   - anything whose text is not text for reading - `head`, `style`, and
 *     `noscript`, whose content is markup the browser deliberately did not use.
 *
 * `img` is here on purpose (D41): a picture from the article's own CDN is still
 * a network request made by this extension, and there is exactly one of those
 * in its life.
 */
const DROPPED = new Set([
  "script", "style", "noscript", "template", "head", "title", "meta", "link", "base",
  "iframe", "frame", "frameset", "object", "embed", "applet", "portal",
  "canvas", "svg", "math", "video", "audio", "source", "track", "img", "picture", "map", "area",
  "form", "input", "button", "select", "textarea", "option", "optgroup", "label",
  "fieldset", "legend", "dialog", "menu", "slot",
]);

/**
 * Attributes kept per element. Everything else goes, including `class`, `id`
 * and `style` - which is not only safety. Dropping them is what makes the
 * reader's typography the reader's: a page cannot bring its own layout in.
 */
const ATTRIBUTES = new Map([
  ["a", ["href"]],
  ["abbr", ["title"]],
  ["time", ["datetime"]],
  ["th", ["colspan", "rowspan", "scope"]],
  ["td", ["colspan", "rowspan"]],
  ["ol", ["start", "reversed", "type"]],
  ["li", ["value"]],
  ["blockquote", ["cite"]],
  ["q", ["cite"]],
]);

/** Kept on anything, because both are about reading the text, not styling it. */
const EVERYWHERE = ["lang", "dir"];

/**
 * Schemes a link may point at. `javascript:` is the one everybody names, but
 * `data:` matters as much: a `data:text/html` link opens a document that would
 * inherit this page's origin in some browsers, and no article needs one.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** @typedef {"keep" | "drop" | "unwrap"} Decision */

/**
 * Three answers, not two. Unwrapping is what keeps an article whose paragraphs
 * live inside `<article>`, `<section>` or some site's own custom element: the
 * element goes, its children stay. Dropping that instead would lose the text
 * for no gain, since the element itself carries nothing once its attributes are
 * gone.
 *
 * @param {string} tagName as the DOM spells it, any case
 * @returns {Decision}
 */
export function decide(tagName) {
  const name = tagName.toLowerCase();
  if (DROPPED.has(name)) return "drop";
  if (KEPT.has(name)) return "keep";
  return "unwrap";
}

/**
 * @param {string} tagName
 * @returns {string[]} attribute names worth asking this element for
 */
export function allowedAttributes(tagName) {
  return [...(ATTRIBUTES.get(tagName.toLowerCase()) ?? []), ...EVERYWHERE];
}

/**
 * A link's destination, made absolute, or nothing.
 *
 * Absolute because the reader is served from `moz-extension://` and a relative
 * link would resolve against that - a link into the extension's own package
 * rather than the site. Readability does this too, but only when it was given a
 * base URL; this is the place that cannot be skipped.
 *
 * @param {unknown} value the `href` as written in the page
 * @param {string} base the address the page came from
 * @returns {string | null}
 */
export function safeHref(value, base) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value, base);
    return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    // Not a URL at all, which is a link nobody can follow either way.
    return null;
  }
}
