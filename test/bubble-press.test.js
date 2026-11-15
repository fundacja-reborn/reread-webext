import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

/**
 * Everything in the bubble that can be pressed answers the press (D301), and
 * what keeps a press from showing is never a missing rule alone - it is a
 * rule that loses. The dark papers dressed the framed doors with selectors
 * more specific than the press, so Save on dark paper answered a finger with
 * nothing; the launcher's hover stood after its press at equal weight, so a
 * door under a cursor answered the button going down with its hover. Neither
 * shows on the one screen a smoke test is run on unless somebody presses that
 * button on that paper with that pointer.
 *
 * No browser runs here, so the cascade is worked out by hand: the sheet is
 * cut into rules, each selector is weighed the way a browser weighs it, and
 * the questions are about which rule wins - by weight first, by order second.
 */

/**
 * @typedef {object} Rule
 * @property {string} selector one selector of the rule's list
 * @property {string} body the rule's declarations
 * @property {number} order where the rule stands in the sheet
 * @property {[number, number, number]} weight ids, classes, types
 */

/**
 * @param {string} text
 * @returns {string[]} the parts between top-level commas
 */
function splitList(text) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts.filter((part) => part.length > 0);
}

/**
 * A selector's specificity. `:is()`, `:not()` and `:has()` weigh as their
 * heaviest argument, `:where()` as nothing; every other pseudo-class and
 * every attribute weighs as a class.
 *
 * @param {string} selector
 * @returns {[number, number, number]}
 */
function weigh(selector) {
  /** @type {[number, number, number]} */
  const total = [0, 0, 0];
  let at = 0;
  while (at < selector.length) {
    const rest = selector.slice(at);
    const functional = /^:(is|not|has|where)\(/.exec(rest);
    if (functional !== null) {
      let depth = 0;
      let end = at + functional[0].length - 1;
      for (; end < selector.length; end += 1) {
        if (selector[end] === "(") depth += 1;
        else if (selector[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (functional[1] !== "where") {
        const inner = splitList(selector.slice(at + functional[0].length, end)).map(weigh);
        inner.sort((one, other) => other[0] - one[0] || other[1] - one[1] || other[2] - one[2]);
        const heaviest = inner[0] ?? [0, 0, 0];
        total[0] += heaviest[0];
        total[1] += heaviest[1];
        total[2] += heaviest[2];
      }
      at = end + 1;
      continue;
    }
    const attribute = /^\[[^\]]*\]/.exec(rest);
    if (attribute !== null) {
      total[1] += 1;
      at += attribute[0].length;
      continue;
    }
    const named = /^(#|\.|::|:)?[a-zA-Z][\w-]*/.exec(rest);
    if (named !== null) {
      const sigil = named[1];
      if (sigil === "#") total[0] += 1;
      else if (sigil === "." || sigil === ":") total[1] += 1;
      else total[2] += 1;
      at += named[0].length;
      continue;
    }
    at += 1;
  }
  return total;
}

/**
 * The sheet as its innermost rules, one entry per selector: a media query's
 * own braces hold no declarations, so the rules inside it are what is found
 * and its condition is left out - every question below is about a screen
 * where the query holds.
 *
 * @returns {Rule[]}
 */
function rules() {
  const bare = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {Rule[]} */
  const out = [];
  let order = 0;
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    order += 1;
    for (const selector of splitList(selectors ?? "")) {
      if (selector.startsWith("@")) continue;
      out.push({ selector, body: body ?? "", order, weight: weigh(selector) });
    }
  }
  return out;
}

const RULES = rules();

/**
 * @param {Rule} one
 * @param {Rule} other
 * @returns {boolean} whether `one` wins over `other` where both apply
 */
function outranks(one, other) {
  for (const at of [0, 1, 2]) {
    const mine = one.weight[at] ?? 0;
    const theirs = other.weight[at] ?? 0;
    if (mine !== theirs) return mine > theirs;
  }
  return one.order > other.order;
}

/**
 * @param {string} selector
 * @returns {Rule}
 */
function ruleFor(selector) {
  const found = RULES.find((rule) => rule.selector === selector);
  assert.ok(found !== undefined, `the stylesheet lost its rule for ${selector}`);
  return found;
}

/**
 * @param {Rule} rule
 * @returns {boolean}
 */
function paints(rule) {
  return /(^|[;\s])background\s*:/.test(rule.body);
}

/** A rule that is itself an answer to a press: the press, or the hover a tap
 *  leaves behind on the touch tier.
 *  @param {Rule} rule
 *  @returns {boolean} */
function isPress(rule) {
  return rule.selector.includes(":active") || (rule.selector.includes('[data-pointer="coarse"]') && rule.selector.includes(":hover"));
}

/** @param {Rule} rule
 *  @returns {boolean} */
function isLauncher(rule) {
  return rule.selector.startsWith('.bubble[data-variant="launcher"]');
}

describe("the bubble answers a press (D301)", () => {
  it("weighs selectors the way a browser does", () => {
    assert.deepEqual(weigh(".actions button"), [0, 1, 1]);
    assert.deepEqual(weigh('.actions button[data-action="save"]:active:not(:disabled):not([aria-disabled="true"])'), [0, 5, 1]);
    assert.deepEqual(weigh('.bubble:not([data-scheme]) .actions :is(button[data-action="save"], button[data-action="reader"]):hover'), [0, 5, 1]);
    assert.deepEqual(weigh(":where(.a, #b) summary"), [0, 0, 1]);
  });

  it("gives every pressable thing a press drawn with the one wash", () => {
    for (const selector of [
      '.actions button:active:not(:disabled):not([aria-disabled="true"])',
      ".copy-row button:active",
      ".context-toggle:active",
      ".hint-link:active",
      '.bubble[data-variant="launcher"] .actions button:active',
    ]) {
      assert.match(ruleFor(selector).body, /background:\s*var\(--press\);/, `${selector} is not the bubble's press`);
    }
    // The two filled things give up a quarter of their ink instead: the
    // quarter of ink would stand under a picture drawn in the paper's colour.
    for (const selector of [
      '.actions button[data-action="speak"]:is([aria-busy="true"], [aria-pressed="true"]):active',
      '.bubble[data-variant="launcher"] .actions button[data-action="reader"]:active',
    ]) {
      assert.match(ruleFor(selector).body, /background:\s*var\(--press-filled\);/, `${selector} is not the filled press`);
    }
  });

  it("lets no rule that is not a press outrank the press on a framed door", () => {
    for (const action of ["save", "reader", "settings"]) {
      const press = RULES.find((rule) => rule.selector.startsWith(`.actions button[data-action="${action}"]:active`));
      assert.ok(press !== undefined, `the ${action} door has no press`);
      for (const rule of RULES) {
        if (!paints(rule) || isPress(rule) || isLauncher(rule)) continue;
        // Every way the sheet names a door: by itself, or inside a list.
        if (!rule.selector.includes(`button[data-action="${action}"]`)) continue;
        assert.ok(!outranks(rule, press), `"${rule.selector}" paints the ${action} door over its press`);
      }
    }
  });

  it("dresses the doors on every paper through the variables, never through a paper's own rule", () => {
    for (const rule of RULES) {
      if (!paints(rule) || isPress(rule)) continue;
      if (!rule.selector.includes(".actions")) continue;
      assert.ok(
        !/\[data-scheme|prefers-color-scheme/.test(rule.selector),
        `"${rule.selector}" dresses a button for one paper - that is what --door-rest, --door-hover and --press are for`,
      );
    }
    assert.match(ruleFor('.actions button[data-action="save"]').body, /background:\s*var\(--door-rest\);/);
    assert.match(ruleFor('.actions button[data-action="save"]:hover:not(:disabled):not([aria-disabled="true"])').body, /background:\s*var\(--door-hover\);/);
    // Both dark papers name the pair, so a door there is told from the paper
    // at rest and from itself under a cursor.
    for (const paper of ['.bubble:not([data-scheme])', '.bubble[data-scheme="dark"]']) {
      const body = ruleFor(paper).body;
      assert.match(body, /--door-rest:\s*rgba\(255, 255, 255, 0\.08\);/, `${paper} lost the doors' tint at rest`);
      assert.match(body, /--door-hover:\s*rgba\(255, 255, 255, 0\.16\);/, `${paper} lost the doors' tint under a cursor`);
    }
  });

  it("keeps the press a quarter of the ink, and a grey the panel shows on e-ink paper", () => {
    const base = ruleFor(".bubble").body;
    assert.match(base, /--press:\s*color-mix\(in srgb, var\(--door-ink\) 25%, transparent\);/);
    assert.match(base, /--press-filled:\s*color-mix\(in srgb, var\(--door-ink\) 75%, var\(--door-paper\)\);/);
    // The pages' own lit grey (page.css, D237): four greys under white is the
    // floor a Boox renders without a stain.
    assert.match(ruleFor('.bubble[data-scheme="eink"]').body, /--press:\s*#dddddd;/);
    // And the press that closes the open clipboard is one grey under it.
    assert.match(ruleFor('.bubble[data-scheme="eink"] .actions button[data-action="copy"][aria-expanded="true"]:active').body, /background:\s*#cccccc;/);
  });

  it("lets a press outrank the hover it happens under", () => {
    /** @type {[string, string][]} */
    const pairs = [
      ['.actions button:active:not(:disabled):not([aria-disabled="true"])', ".actions button:hover:not(:disabled)"],
      [".copy-row button:active", ".copy-row button:hover"],
      [".context-toggle:active", ".context-toggle:hover"],
      [".hint-link:active", ".hint-link:hover"],
      [
        '.actions button[data-action="save"]:active:not(:disabled):not([aria-disabled="true"])',
        '.actions button[data-action="save"]:hover:not(:disabled):not([aria-disabled="true"])',
      ],
      ['.actions button[data-action="settings"]:active:not(:disabled)', '.actions button[data-action="settings"]:hover:not(:disabled)'],
      // The launcher's pairs weigh the same, so the order is the whole of it.
      ['.bubble[data-variant="launcher"] .actions button:active', '.bubble[data-variant="launcher"] .actions button:hover'],
      [
        '.bubble[data-variant="launcher"] .actions button[data-action="reader"]:active',
        '.bubble[data-variant="launcher"] .actions button[data-action="reader"]:hover',
      ],
    ];
    for (const [press, hover] of pairs) {
      assert.ok(outranks(ruleFor(press), ruleFor(hover)), `${hover} wins over ${press}`);
    }
  });

  it("keeps a filled button readable while it is pressed", () => {
    const quiet = ruleFor('.actions button:active:not(:disabled):not([aria-disabled="true"])');
    // The speaker in its filled dress: the labels' press must lose to its own.
    assert.ok(outranks(ruleFor('.actions button[data-action="speak"]:is([aria-busy="true"], [aria-pressed="true"]):active'), quiet));
    // The launcher's filled door: neither the labels' press nor the hover a
    // tap leaves on the touch tier may put the quarter of ink under its words.
    const lingering = ruleFor('[data-pointer="coarse"] .actions button[data-action="reader"]:hover:not(:disabled)');
    assert.ok(outranks(ruleFor('.bubble[data-variant="launcher"] .actions button[data-action="reader"]:active'), quiet));
    assert.ok(
      outranks(ruleFor('.bubble[data-variant="launcher"][data-pointer="coarse"] .actions button[data-action="reader"]:hover'), lingering),
      "a tap leaves the launcher's filled door pale under words in the paper's colour",
    );
  });

  it("says the clipboard row is open on the button that opened it", () => {
    const open = ruleFor('.actions button[data-action="copy"][aria-expanded="true"]');
    assert.match(open.body, /background:\s*var\(--press\);/);
    assert.match(open.body, /opacity:\s*1;/);
    // One signal, the wash: nothing drawn around it (PR #387's rule for a
    // control that is on).
    assert.doesNotMatch(open.body, /outline|box-shadow|border/);
  });

  it("leaves no wash behind a tap on a label: the lingering hover belongs to the framed doors alone", () => {
    for (const rule of RULES) {
      if (!rule.selector.includes('[data-pointer="coarse"]') || !rule.selector.includes(":hover") || !paints(rule)) continue;
      assert.match(rule.selector, /button\[data-action="(save|reader|settings)"\]/, `"${rule.selector}" keeps a pressed look after the tap`);
    }
  });
});
