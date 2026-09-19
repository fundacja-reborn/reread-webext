import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The two blocks every catalogue on the settings page is read in (D263,
 * Michał's plan): what is on this device, and what can be fetched.
 *
 * The tools of a catalogue - a filter over a hundred pairs and four hundred
 * dictionaries, the press that fetches the index again, the day it is from -
 * used to stand between the subsection's opening sentences and the two or
 * three things somebody actually has. The page opened on the machinery of a
 * list rather than on the list, and the filter narrowed what was installed as
 * readily as what was not.
 *
 * What is held here is the shape, in both subsections at once: a heading per
 * block with the anchor the page's own doors land on, the tools inside the
 * catalogue block and nowhere else, the by-hand doors after the catalogue, and
 * the host's note after all of them.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * One block of a subsection: everything from its heading to the next
 * `</section>`, which is where the block ends.
 *
 * @param {string} markup
 * @param {string} id the heading's id
 * @returns {string}
 */
function block(markup, id) {
  const at = markup.indexOf(`<h4 id="${id}"`);
  assert.ok(at > 0, `no block headed ${id}`);
  const end = markup.indexOf("</section>", at);
  assert.ok(end > at, `${id} is never closed`);
  return markup.slice(at, end);
}

const SUBSECTIONS = [
  {
    what: "models",
    installed: "translation-models-installed",
    available: "translation-models-available",
    list: 'id="models" class="models"',
    catalog: 'id="models-catalog" class="models"',
    filter: 'id="model-filter"',
    update: 'id="refresh-models"',
    showAll: 'id="models-show-all"',
    door: "options_add_model_heading",
    host: 'id="model-host"',
    name: "options_list_available_models",
    search: 'id="model-search"',
    dated: 'data-i18n="options_list_dated_models"',
  },
  {
    what: "dictionaries",
    installed: "dictionaries-installed",
    available: "dictionaries-available",
    list: 'id="dictionary-list"',
    catalog: 'id="dictionary-catalog" class="models"',
    filter: 'id="dictionary-filter"',
    update: 'id="refresh-dictionaries"',
    showAll: 'id="dictionaries-show-all"',
    door: "options_add_dictionary_heading",
    host: 'id="dictionary-host"',
    name: "options_list_available_dictionaries",
    search: 'id="dictionary-search"',
    dated: 'data-i18n="options_list_dated_dictionaries"',
  },
];

describe("the two blocks a catalogue is read in", () => {
  it("head each block with its own name, in both subsections", async () => {
    const markup = await source("options/options.html");
    for (const part of SUBSECTIONS) {
      // The name stands inside the card it heads (D265), in the card label's
      // own dress - a heading outside a card opens a section, and these open
      // a block of one. Since Michał's second round the catalogue block is
      // named for what a press there does ("Download dictionaries"), which is
      // a different sentence for each of the two lists - and a different one
      // again once something is on the device (the test below).
      assert.match(
        markup,
        new RegExp(`<h4 id="${part.installed}" class="card-head" data-i18n="options_list_installed">`),
        `the ${part.what} do not say what is on this device`,
      );
      assert.match(
        markup,
        new RegExp(`<h4 id="${part.available}" class="card-head" data-i18n="${part.name}">`),
        `the ${part.what} do not say what can be fetched`,
      );
      // In that order: what is here before what could be.
      assert.ok(
        markup.indexOf(`id="${part.installed}"`) < markup.indexOf(`id="${part.available}"`),
        `the ${part.what} put the catalogue first`,
      );
    }
  });

  it("keep the catalogue's tools inside the catalogue's own block", async () => {
    const markup = await source("options/options.html");
    for (const part of SUBSECTIONS) {
      const here = block(markup, part.installed);
      const there = block(markup, part.available);

      assert.ok(here.includes(part.list), `the ${part.what} on this device are not listed in their own block`);
      assert.ok(!here.includes(part.filter), `the ${part.what} filter still stands over what is installed`);
      assert.ok(!here.includes(part.update), `the ${part.what} refresh still stands over what is installed`);
      assert.ok(!here.includes(part.dated), `the ${part.what} block says how old the catalogue is`);

      assert.ok(there.includes(part.catalog), `the ${part.what} catalogue is not in the catalogue block`);
      assert.ok(there.includes(part.filter), `the ${part.what} filter left the catalogue`);
      assert.ok(there.includes(part.update), `the ${part.what} refresh left the catalogue`);
      assert.ok(there.includes(part.showAll), `the ${part.what} fold left the catalogue`);
      assert.ok(there.includes(part.door), `the by-hand door left the ${part.what} catalogue`);
    }
  });

  it("stands the field and the press that answers it on one line, and the date in prose (Michał, 2026-09-19)", async () => {
    const markup = await source("options/options.html");
    for (const part of SUBSECTIONS) {
      const block = markup.slice(markup.indexOf(`id="${part.available}"`));
      const tools = block.slice(block.indexOf('<div class="list-tools">'));
      const line = tools.slice(0, tools.indexOf("</div>", tools.indexOf(part.search)));
      assert.ok(line.includes(part.filter), `the ${part.what} filter is not on the tools line`);
      assert.ok(line.includes("list-search"), `the ${part.what} field has no press to answer it`);
      // The press that fetches the index again is not on that line: it works
      // without a word typed, and it stands where a reader looks for Search.
      // It is a link inside the sentence about the date it changes, and that
      // sentence opens the card.
      assert.ok(!line.includes(part.update), `the ${part.what} refresh still stands beside the field`);
      const dated = block.indexOf(part.dated);
      assert.ok(dated > 0 && dated < block.indexOf('<div class="list-tools">'), `the ${part.what} list does not open on the day it is from`);
      const sentence = block.slice(dated, block.indexOf("</p>", dated));
      assert.ok(sentence.includes(part.update), `the ${part.what} date does not offer to fetch the list again`);
      assert.ok(sentence.includes('data-i18n="options_update_list_link"'), `the ${part.what} refresh is not a link in the sentence`);
    }

    const css = await source("options/options.css");
    const tools = css.slice(css.indexOf(".list-tools {"), css.indexOf("}", css.indexOf(".list-tools {")));
    assert.match(tools, /display: flex/);
    // The field takes what the button leaves, and can shrink below its
    // content - without `min-width: 0` a search box refuses to.
    const field = css.slice(css.indexOf(".list-tools .model-filter {"));
    assert.match(field.slice(0, field.indexOf("}")), /flex: 1 1 auto;\s+min-width: 0/);
    // The card decides, not the window (D265): the field takes the width and
    // the button stands under it wherever the card is too narrow for both.
    const narrow = css.slice(css.indexOf("@container (max-width: 30rem)"));
    assert.match(narrow, /\.list-tools \{\n    flex-wrap: wrap;/, "the tools line never splits in a narrow card");
  });

  it("put the note about the host after both blocks, as the subsection's own footnote", async () => {
    const markup = await source("options/options.html");
    for (const part of SUBSECTIONS) {
      const host = markup.indexOf(part.host);
      assert.ok(host > markup.indexOf(part.showAll), `the ${part.what} host note stands inside the catalogue`);
      assert.ok(host > markup.indexOf(part.door), `the ${part.what} host note stands before the by-hand door`);
    }
  });

  it("send every door that means \"go and fetch one\" to the catalogue block (K5)", async () => {
    const markup = await source("options/options.html");
    for (const href of ["#translation-models-available", "#dictionaries-available"]) {
      assert.ok(markup.includes(`href="${href}"`), `nothing leads to ${href}`);
    }
    // And the landing hands the focus on to the field somebody came to type
    // in - the heading keeps the scroll and the announcement.
    const sections = await source("options/sections.js");
    assert.match(sections, /focusFilterOf\(landed\);/);
    assert.match(sections, /landed\.tagName === "H4"/);
    assert.match(sections, /section\.querySelector\("input\[type='search'\]"\)/);
  });

  it("names the catalogue for the act, and for the act on a device that has one already", async () => {
    const script = await source("options/options.js");
    // "Download dictionaries" while nothing is here, "Download more
    // dictionaries" once something is (Michał, 2026-09-19): the second is a
    // lie on a fresh install, and the first sells the block short on a device
    // that already reads two languages.
    assert.match(
      script,
      /sayCatalogHeading\(\n\s+"translation-models-available",\n\s+t\("options_list_available_models"\),\n\s+t\("options_list_available_models_more"\),\n\s+here\.length > 0,/,
      "the models' catalogue is named the same whatever is on the device",
    );
    assert.match(
      script,
      /sayCatalogHeading\(\n\s+"dictionaries-available",\n\s+t\("options_list_available_dictionaries"\),\n\s+t\("options_list_available_dictionaries_more"\),\n\s+stored\.length > 0,/,
      "the dictionaries' catalogue is named the same whatever is on the device",
    );
    // Both names are said, never glued from a key: a key built out of a value
    // is a key the catalogue tests cannot see.
    const helper = script.slice(script.indexOf("function sayCatalogHeading("), script.indexOf("\n}\n", script.indexOf("function sayCatalogHeading(")));
    assert.doesNotMatch(helper, /t\(`/, "the heading's key is glued together at the call");
    // And the empty list's own door says the first of the two, which is what
    // an empty list makes true.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      for (const key of [
        "options_list_available_models",
        "options_list_available_models_more",
        "options_list_available_dictionaries",
        "options_list_available_dictionaries_more",
      ]) {
        assert.equal(typeof catalogue[key]?.message, "string", `${locale} has no ${key}`);
      }
    }
  });

  it("answer an empty list with the way to the catalogue, not with a dead end", async () => {
    const script = await source("options/options.js");
    assert.match(script, /"translation-models-available",\n\s+"options_list_available_models",/);
    assert.match(script, /"dictionaries-available",\n\s+"options_list_available_dictionaries",/);
    const helper = script.slice(script.indexOf("function emptyList("), script.indexOf("function dictionaryGroups("));
    assert.match(helper, /door\.href = `#\$\{anchor\}`/);
    // The door says what the heading it lands on says - one name per list.
    assert.match(helper, /door\.textContent = t\(name\)/);
    // And a delete that empties the list leaves the focus on the block's own
    // heading, since the filter it used to fall back to is now a block away.
    assert.match(script, /focusDeleteIn\("models", "translation-models-installed", at\)/);
    assert.match(script, /focusDeleteIn\("dictionary-list", "dictionaries-installed", at\)/);
  });

  it("indexes the blocks for the search, and still none of their rows", async () => {
    const search = await source("options/search.js");
    assert.match(search, /section\.querySelector\("h2, h3, h4"\)/, "a block's heading is not indexed");
    // The rule that has held since D254: the catalogues are data, and a
    // search over them would answer with the data rather than the setting.
    assert.doesNotMatch(search, /dictionary-catalog|models-catalog|disabled-hosts|custom-css-text/);
  });

  it("filters the catalogue alone, and says what was typed when nothing matches (K2)", async () => {
    const script = await source("options/options.js");
    assert.match(script, /applyFilterIn\("models-catalog", "model-filter", "model-none", "models-show-all", modelsExpanded/);
    assert.match(script, /"dictionary-catalog",\n\s+"dictionary-filter",\n\s+"dictionary-none",/);
    // Nothing the filter reaches is installed any more, so the fold's
    // "installed rows stay on screen" rule leaves the catalogue folded until
    // it is asked - the behaviour the round kept deliberately.
    assert.match(script, /rendered\.dataset\["installed"\] = "false";/);
    assert.match(script, /t\("options_filter_no_match_models", query\)/);
    assert.match(script, /t\("options_filter_no_match_dictionaries", query\)/);
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      assert.match(catalogue["options_filter_no_match_models"].message, /\$QUERY\$/, `${locale} does not quote the query`);
      assert.match(catalogue["options_filter_no_match_dictionaries"].message, /\$QUERY\$/, `${locale} does not quote the query`);
    }
  });
});
