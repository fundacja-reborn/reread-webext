import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyReading, applyTheme } from "../src/lib/appearance.js";
import { READER_DEFAULTS } from "../src/lib/config.js";

/**
 * Enough of a document root for the appearance rules: the dataset the
 * attributes land in, and a style that remembers what was set on it.
 *
 * @returns {{ dataset: Record<string, string | undefined>,
 *   style: { setProperty(name: string, value: string): void },
 *   properties: Record<string, string> }}
 */
function fakeRoot() {
  /** @type {Record<string, string>} */
  const properties = {};
  return {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties[name] = value;
      },
    },
    properties,
  };
}

describe("applyTheme", () => {
  it("stamps the theme attribute the palettes key on", () => {
    const root = fakeRoot();
    applyTheme(root, "sepia");
    assert.equal(root.dataset["readerTheme"], "sepia");
  });

  it("stamps auto too - the value no palette matches", () => {
    // A page switched back to auto must lose the hand-set palette, and the
    // stamp of a value the CSS ignores is how the attribute never lingers.
    const root = fakeRoot();
    applyTheme(root, "dark");
    applyTheme(root, "auto");
    assert.equal(root.dataset["readerTheme"], "auto");
  });
});

describe("applyReading", () => {
  it("dresses paper, typeface and text size - and nothing else", () => {
    const root = fakeRoot();
    applyReading(root, { ...READER_DEFAULTS, theme: "dark", font: "sans", fontSize: 21 });
    assert.equal(root.dataset["readerTheme"], "dark");
    assert.equal(root.dataset["readerFont"], "sans");
    assert.deepEqual(root.properties, { "--reader-size": "21px" });
    // The column's measure and the links mode are the reader page's own; a
    // list page handed them here by mistake must not start wearing them.
    assert.equal(root.dataset["readerLinks"], undefined);
  });
});
