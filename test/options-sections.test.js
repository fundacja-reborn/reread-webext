import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { DEFAULTS, READER_DEFAULTS } from "../src/lib/config.js";

/**
 * The shape of the settings page (D254): which sections it has, in what
 * order, what each row is called, and which addresses keep working.
 *
 * None of this is visible in a smoke test run in one language on one screen
 * - a section quietly renamed, a row that lost its identity, an anchor the
 * popup still sends people to: each of those breaks somewhere else, days
 * later. So the page's own map is held here, statically, against the same
 * file the build copies into the package.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/** The sections, in the order the page stands them in. */
const SECTIONS = [
  { id: "languages", key: "options_section_languages", subs: ["translation-models", "dictionaries"] },
  { id: "where-it-works", key: "options_section_where", subs: ["switched-off-sites"] },
  { id: "bubble-and-phrases", key: "options_section_bubble", subs: ["bubble", "saved-phrases"] },
  { id: "reading-view", key: "options_section_reading", subs: ["paged-layout"] },
  { id: "reading-aloud", key: "options_section_aloud", subs: [] },
  { id: "data", key: "options_section_data", subs: [] },
  { id: "custom-css", key: "options_custom_css_heading", subs: [] },
  { id: "about", key: "options_section_about", subs: ["support"] },
];

/**
 * Every row of the page, in order, named by the setting it writes. `pair`
 * writes two keys and `storage` writes none - the rest are config keys, and
 * the test below holds them to that.
 */
const ROWS = [
  { setting: "pair", section: "languages", control: "pair" },
  { setting: "translationOff", section: "translation-models", control: "no-translation" },
  { setting: "bubbleOff", section: "translation-models", control: "bubble-off" },
  { setting: "readerOnly", section: "where-it-works", control: "reader-only" },
  { setting: "showBubbleMore", section: "bubble", control: "bubble-more" },
  { setting: "hideBubbleActions", section: "bubble", control: "quiet-bubble" },
  { setting: "bubbleScale", section: "bubble", control: "bubble-scale-up" },
  { setting: "saveSentence", section: "saved-phrases", control: "save-sentence" },
  { setting: "underlineForms", section: "saved-phrases", control: "underline-forms" },
  { setting: "keepArticles", section: "reading-view", control: "keep-articles" },
  { setting: "fontFamily", section: "reading-view", control: "font-custom" },
  { setting: "readingPace", section: "reading-view", control: "reading-pace" },
  { setting: "pageNumber", section: "paged-layout", control: "page-number" },
  { setting: "touchTurn", section: "paged-layout", control: "touch-turn" },
  { setting: "turnEffect", section: "paged-layout", control: "turn-effect" },
  { setting: "ttsOff", section: "reading-aloud", control: "tts" },
  { setting: "ttsVoices", section: "reading-aloud", control: "tts-voice" },
  { setting: "ttsRate", section: "reading-aloud", control: "tts-rate-up" },
  { setting: "storage", section: "data", control: null },
  { setting: "libraryCopy", section: "data", control: "library-copy" },
];

describe("the settings page's sections", () => {
  it("stands its sections in the order the table of contents names", async () => {
    const markup = await source("options/options.html");
    /** @param {string} id */
    const headingAt = (id) => markup.indexOf(`<h2 id="${id}"`);

    let previous = -1;
    for (const section of SECTIONS) {
      const at = headingAt(section.id);
      assert.ok(at > 0, `no section heading for ${section.id}`);
      assert.ok(at > previous, `${section.id} stands out of order`);
      assert.match(
        markup.slice(at, markup.indexOf("\n", at)),
        new RegExp(`data-i18n="${section.key}"`),
        `${section.id} is not named from the catalogue`,
      );
      previous = at;
      // Every subsection stands inside its section, as an h3 - the level
      // below it, with nothing skipped (the accessibility rule).
      let inner = at;
      for (const sub of section.subs) {
        const subAt = markup.indexOf(`<h3 id="${sub}"`, at);
        assert.ok(subAt > 0, `no subsection heading for ${sub}`);
        assert.ok(subAt > inner, `${sub} stands out of order inside ${section.id}`);
        inner = subAt;
      }
    }
  });

  it("lists every section in the page's own table of contents, in the same order", async () => {
    const markup = await source("options/options.html");
    const from = markup.indexOf('<nav id="sections"');
    const nav = markup.slice(from, markup.indexOf("</nav>", from));
    const listed = [...nav.matchAll(/href="#([a-z-]+)"/g)].map((match) => String(match[1]));
    assert.deepEqual(
      listed,
      ["first-steps", ...SECTIONS.map((section) => section.id)],
      "the table of contents and the page disagree about the sections",
    );
  });

  it("keeps every address the rest of the extension still names", async () => {
    const markup = await source("options/options.html");
    // `#dictionaries` is the one with a contract outside this page: the
    // background walks to it by name (`SETTINGS_SECTIONS`). The others are
    // in the README, in old bookmarks and in links people have shared.
    for (const anchor of [
      "first-steps",
      "translation-models",
      "dictionaries",
      "switched-off-sites",
      "paged-layout",
      "custom-css",
      "support",
    ]) {
      assert.ok(markup.includes(`id="${anchor}"`), `the address #${anchor} is gone`);
    }
    const { SETTINGS_SECTIONS } = await import("../src/lib/protocol.js");
    for (const section of SETTINGS_SECTIONS) {
      assert.ok(markup.includes(`id="${section}"`), `the protocol walks to #${section}, which is not on the page`);
    }
  });

  it("gives every row one name - the setting it writes - for the deep link and the index", async () => {
    const markup = await source("options/options.html");
    const found = [
      ...markup.matchAll(
        /id="s-([A-Za-z]+)" data-setting="([A-Za-z]+)"(?: data-keywords="[a-z_]+")?(?: data-parent="[A-Za-z]+")? data-section="([a-z-]+)"/g,
      ),
    ].map((match) => ({ id: String(match[1]), setting: String(match[2]), section: String(match[3]) }));
    assert.deepEqual(
      found.map((row) => ({ setting: row.setting, section: row.section })),
      ROWS.map((row) => ({ setting: row.setting, section: row.section })),
      "the rows or their order have drifted from the page's map",
    );
    for (const row of found) {
      assert.equal(row.id, row.setting, `s-${row.id} and data-setting="${row.setting}" must be one name`);
    }
  });

  it("names rows after real settings, so the index cannot point at nothing", async () => {
    const stored = new Set([...Object.keys(DEFAULTS), ...Object.keys(READER_DEFAULTS)]);
    for (const row of ROWS) {
      // The pair writes two keys at once and the storage row writes none -
      // it reports. Everything else is a key `config.js` knows.
      if (row.setting === "pair" || row.setting === "storage") continue;
      assert.ok(stored.has(row.setting), `no setting is stored under "${row.setting}"`);
    }
  });

  it("keeps the sub-option beside the switch that brings it (Michał's call, 2026-09-18)", async () => {
    const markup = await source("options/options.html");
    const parent = markup.indexOf('id="s-translationOff"');
    const child = markup.indexOf('id="s-bubbleOff"');
    assert.ok(parent > 0 && child > parent, "the sub-option no longer follows its switch");
    assert.doesNotMatch(
      markup.slice(parent + 1, child),
      /id="s-/,
      "a row stands between the switch and the sub-option it brings",
    );
    assert.match(
      markup,
      /<div class="row row-sub" id="s-bubbleOff" data-setting="bubbleOff" data-parent="translationOff"/,
      "the sub-option lost its indent or the switch it names as its parent",
    );
  });

  it("says the page's thesis in one line and keeps the whole of it in About", async () => {
    const markup = await source("options/options.html");
    const short = markup.indexOf('data-i18n="options_intro_short"');
    const about = markup.indexOf('<h2 id="about"');
    const full = markup.indexOf('data-i18n="options_local_intro"');
    assert.ok(short > 0 && short < about, "the short intro is not under the title");
    assert.ok(full > about, "the whole privacy note is not in the About section");
    assert.match(markup.slice(short, short + 400), /href="#about"/, "the short intro does not lead to the rest of it");
  });
});
