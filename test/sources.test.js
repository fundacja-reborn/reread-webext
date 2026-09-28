import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { dictionarySourcesLink, storeReviewLink } from "../src/lib/sources.js";

describe("dictionarySourcesLink", () => {
  it("sends a Polish interface to the Polish page, and every other to the English one", () => {
    assert.deepEqual(dictionarySourcesLink("pl"), {
      href: "https://reapps.eu/pl/read#faq-dictionary-sources",
      label: "reapps.eu/pl/read",
    });
    assert.deepEqual(dictionarySourcesLink("pl-PL"), dictionarySourcesLink("pl"));
    for (const locale of ["en", "en-US", "de", "fr", "es", "uk", ""]) {
      assert.deepEqual(dictionarySourcesLink(locale), {
        href: "https://reapps.eu/read#faq-dictionary-sources",
        label: "reapps.eu/read",
      });
    }
  });

  it("names the page the way the reader sees it, with the anchor in the address alone", () => {
    for (const locale of ["pl", "en"]) {
      const { href, label } = dictionarySourcesLink(locale);
      assert.ok(href.startsWith("https://"), "the address is not https");
      assert.ok(href.endsWith("#faq-dictionary-sources"), "the address lost the answer's anchor");
      assert.ok(href.includes(label), "the words do not name the page they open");
      assert.doesNotMatch(label, /#|https?:/, "the words carry more than the page's name");
    }
  });
});

describe("storeReviewLink", () => {
  const firefox = "https://addons.mozilla.org/firefox/addon/reread/reviews/";
  const chromium = "https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla/reviews";

  it("aims Firefox at addons.mozilla.org and every Chromium at the Chrome Web Store", () => {
    assert.deepEqual(storeReviewLink("moz-extension:"), {
      href: firefox,
      label: "addons.mozilla.org",
    });
    assert.deepEqual(storeReviewLink("chrome-extension:"), {
      href: chromium,
      label: "chromewebstore.google.com",
    });
  });

  it("knows no store for Safari, nor for a page that is not the extension's own", () => {
    for (const scheme of ["safari-web-extension:", "https:", "moz-extension", "", "MOZ-EXTENSION:"]) {
      assert.equal(storeReviewLink(scheme), null, `a door opened for ${JSON.stringify(scheme)}`);
    }
  });

  it("names the store the way the reader sees it, with the reviews in the address alone", () => {
    for (const scheme of ["moz-extension:", "chrome-extension:"]) {
      const link = storeReviewLink(scheme);
      assert.ok(link !== null, `no door for ${scheme}`);
      assert.ok(link.href.startsWith("https://"), "the address is not https");
      assert.match(link.href, /\/reviews\/?$/, "the address does not open the reviews");
      assert.ok(link.href.includes(link.label), "the words do not name the store they open");
      assert.doesNotMatch(link.label, /\/|https?:/, "the words carry more than the store's name");
    }
  });

  it("names the same two addresses the README's Support section does", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const support = readme.slice(readme.indexOf("\n## Support"));
    assert.ok(support.includes(`(${firefox})`), "the README's Support section lost the Firefox address");
    assert.ok(support.includes(`(${chromium})`), "the README's Support section lost the Chromium address");
  });
});
