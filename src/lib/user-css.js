/**
 * Custom CSS (D176): rules somebody typed into the settings to dress the
 * bubble and the reader page, screened before they dress anything.
 *
 * The one promise this module keeps is PRIVACY.md's: nothing the extension
 * shows loads anything from outside the package. A stylesheet can reach the
 * network on its own - `url()` in a background, an `@import`, a `@font-face`
 * - so a typed one is not applied as typed. The browser's own parser reads it
 * first (a constructed sheet, `replaceSync`), the parsed rules are walked and
 * the whole sheet is refused at the first rule that could load anything, and
 * what gets adopted is the parser's serialization, never the text.
 * Serialization is what makes the screen honest: the parser resolves escapes
 * and case, so `u\72l(` and `URL(` come out as `url(` before the screen looks.
 *
 * The rule half is pure over a structural shape of the CSSOM, so it runs
 * under `node --test`; the compile half needs a browser.
 */

/**
 * A stylesheet rule as the screen sees it - the CSSOM's shape kept
 * structural: what kind of rule it is, how the browser serializes it, and
 * the rules nested in it (an `@media` block's, a nested style rule's).
 *
 * @typedef {{ kind: RuleKind, cssText: string, rules: RuleLike[] }} RuleLike
 */

/**
 * The kinds the screen tells apart. Everything that is not one of the three
 * refused outright is `other` - a style rule, a grouping rule, a keyframes
 * block - and is screened by its text and its nested rules alone.
 *
 * @typedef {"import" | "font-face" | "namespace" | "other"} RuleKind
 */

/**
 * Why a sheet was refused. `network` is a value that names something to
 * load; the three kinds are refused whatever they say; `unparsed` is the
 * engine declining the text altogether (no constructed sheets, or an older
 * engine throwing on `@import` instead of dropping it).
 *
 * @typedef {"network" | "import" | "font-face" | "namespace" | "unparsed"} Refusal
 */

/**
 * The functions that make a value load something: `url()` and its two
 * modern spellings, and the image sets that take addresses by the list. No
 * word boundary in front on purpose - `-webkit-image-set(` has none - and
 * matched on the serialization, where escapes and case are already resolved.
 * A string that merely contains one of them (`content: "url(x)"`) is refused
 * too; that is a false alarm nobody has a real use for.
 */
const LOADS = /(?:url|src|image|image-set)\(/i;

/**
 * @param {RuleLike} rule
 * @returns {Refusal | null}
 */
function refusal(rule) {
  if (rule.kind !== "other") return rule.kind;
  if (LOADS.test(rule.cssText)) return "network";
  for (const nested of rule.rules) {
    const found = refusal(nested);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The screen itself: every rule of the sheet, or none of them.
 *
 * All or nothing rather than dropping the offending rule: a sheet with a hole
 * in it would dress the bubble differently from what somebody typed and say
 * nothing about why, while the settings page can say why instead.
 *
 * @param {RuleLike[]} rules the sheet's top-level rules, as the parser serialized them
 * @returns {{ ok: true, css: string } | { ok: false, reason: Refusal }}
 *   the sheet's text as the parser wrote it back, one rule per line - or the
 *   first reason to refuse the whole of it
 */
export function screenRules(rules) {
  for (const rule of rules) {
    const found = refusal(rule);
    if (found !== null) return { ok: false, reason: found };
  }
  return { ok: true, css: rules.map((rule) => rule.cssText).join("\n") };
}

/**
 * The CSSOM's rules in the screen's shape.
 *
 * @param {CSSRuleList} list
 * @returns {RuleLike[]}
 */
export function describeRules(list) {
  return Array.from(list, (rule) => {
    const nested = /** @type {{ cssRules?: CSSRuleList }} */ (rule).cssRules;
    return {
      kind: kindOf(rule),
      cssText: rule.cssText,
      rules: nested instanceof CSSRuleList ? describeRules(nested) : [],
    };
  });
}

/**
 * @param {CSSRule} rule
 * @returns {RuleKind}
 */
function kindOf(rule) {
  if (rule instanceof CSSImportRule) return "import";
  if (rule instanceof CSSFontFaceRule) return "font-face";
  if (rule instanceof CSSNamespaceRule) return "namespace";
  return "other";
}

/**
 * The typed text as a sheet the bubble's shadow root and the reader page can
 * adopt, or the reason it was refused. Parsed by the engine that will apply
 * it, screened, and handed back together with the serialization the
 * `<style>` fallback uses where a constructed sheet cannot be adopted
 * (`content/tooltip.js`).
 *
 * Nothing is thrown: the settings page turns a refusal into a sentence, the
 * bubble and the reader into the default look.
 *
 * @param {string} text
 * @returns {{ ok: true, sheet: CSSStyleSheet, css: string } | { ok: false, reason: Refusal }}
 */
export function compileUserCss(text) {
  /** @type {CSSStyleSheet} */
  let sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
  } catch {
    return { ok: false, reason: "unparsed" };
  }
  const screened = screenRules(describeRules(sheet.cssRules));
  if (!screened.ok) return screened;
  return { ok: true, sheet, css: screened.css };
}
