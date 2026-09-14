import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * Learned as a state, not a deletion (D224): the rules have their own tests
 * (`learned`, `unlearned`, `resaved`, `restored`, the copy, the file, the
 * protocol, the two shelves); this reads the call sites they meet at - the
 * one filter the mirror and the files take, the doors the background and
 * the router open, the phrases page's shelves and the acts of the learned
 * one - because a call site that forgets the filter is a phrase underlined
 * after Learned, and no unit test catches that by asking a function.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("Learned as a state (D224) - the background", () => {
  it("builds the mirror from the phrases still being learned, and only those", async () => {
    const background = await source("background/vocabulary.js");
    const rebuild = bodyOf(background, "rebuildMirror");
    assert.match(rebuild, /learningOf\(await listPhrases\(pair\)\)/, "the mirror carries the learned phrases - they stay underlined");
  });

  it("marks on Learned, unmarks on back-to-learning, deletes for good on the shelf's act - one shared road", async () => {
    const background = await source("background/vocabulary.js");
    assert.match(bodyOf(background, "forgetPhrase"), /markPhrase\(request\.text, \(key\) => learnPhrase\(key, Date\.now\(\)\)\)/, "Learned does not mark the row");
    assert.doesNotMatch(bodyOf(background, "forgetPhrase"), /deleteRow|deletePhrase\(/, "Learned still deletes");
    assert.match(bodyOf(background, "unlearnPhrase"), /markPhrase\(request\.text, unlearnRow\)/, "back to learning does not unmark");
    assert.match(bodyOf(background, "deletePhrase"), /markPhrase\(request\.text, deleteRow\)/, "the deletion for good does not delete");
    const road = bodyOf(background, "markPhrase");
    assert.match(road, /const normalized = normalize\(text\);/, "the phrase is not normalized on the shared road");
    assert.match(road, /if \(changed \|\| restored > 0\) await afterWrite\(config\);/, "the copies are rebuilt for nothing, or not at all");
    const whole = bodyOf(background, "deleteLearned");
    assert.match(whole, /const deleted = await deleteLearnedRows\(pair\);/, "the shelf-wide deletion does not reach the store");
    assert.match(whole, /if \(deleted > 0 \|\| restored > 0\) await afterWrite\(config\);/, "the copies are rebuilt for nothing, or not at all");
    assert.match(whole, /return ok\(\{ deleted \}\);/, "the page is not told how many went");
  });

  it("restores a learned phrase from the backup of everything as learned", async () => {
    const restoring = bodyOf(await source("background/vocabulary.js"), "restoreFromBackup");
    assert.match(restoring, /withLearnedAt\(withRestoredCounts\(built\.value, row\), row\.learnedAt\)/, "the learned mark does not reach the row");
  });

  it("answers the three acts at the router's door", async () => {
    const router = await source("background/index.js");
    assert.match(router, /case Message\.UNLEARN_PHRASE:\s*return await unlearnPhrase\(request\);/, "back to learning has no door");
    assert.match(router, /case Message\.DELETE_PHRASE:\s*return await deletePhrase\(request\);/, "the deletion for good has no door");
    assert.match(router, /case Message\.DELETE_LEARNED:\s*return await deleteLearned\(\);/, "the shelf-wide deletion has no door");
  });

  it("leaves a learned row alone when a stale page reports a count or a sentence for it", async () => {
    const store = await source("lib/store/vocab.js");
    assert.match(bodyOf(store, "countPhrases"), /if \(existing === undefined \|\| isLearned\(existing\)\) continue;/, "a count lands on a learned row");
    assert.match(bodyOf(store, "fillSentences"), /if \(existing === undefined \|\| isLearned\(existing\)\) continue;/, "a sentence lands on a learned row");
    assert.match(bodyOf(store, "learnPhrase"), /const next = learned\(existing, now\);\s*if \(next === existing\) return false;/, "Learned writes a row already learned");
    assert.match(bodyOf(store, "deleteLearned"), /if \(!isLearned\(phrase\)\) continue;\s*await promisify\(store\.delete\(phrase\.id\)\);/, "the shelf-wide deletion takes a phrase still being learned");
  });
});

describe("Learned as a state (D224) - the phrases page", () => {
  it("has the two shelves as pressed buttons, and the shelf-wide deletion under the pager", async () => {
    const html = await source("vocab/vocab.html");
    assert.match(html, /<div class="phrase-segments" id="phrase-segments">/, "no shelf buttons");
    assert.match(html, /data-segment="learning" aria-pressed="true" data-i18n="vocab_segment_learning"/, "the learning shelf is not the one pressed at rest");
    assert.match(html, /data-segment="learned" aria-pressed="false" data-i18n="vocab_segment_learned"/, "no learned shelf button");
    const pager = html.indexOf('<nav class="pager" id="pager"');
    const line = html.indexOf('<p id="learned-actions" class="learned-actions" hidden>');
    const transfer = html.indexOf('<section id="transfer"');
    assert.ok(pager !== -1 && line > pager && transfer > line, "the shelf-wide deletion does not stand between the pager and the transfer section");
    assert.match(html, /<button type="button" id="delete-learned" class="quiet quiet-delete-all"><\/button>/, "the shelf-wide deletion is not a quiet text act filled by script");
  });

  it("splits the pair into the two shelves, reads the phrase's standing and makes the files off the learning one", async () => {
    const page = await source("vocab/vocab.js");
    const reload = bodyOf(page, "reload");
    assert.match(reload, /const shelves = splitSegments\(list\);\s*phrases = newestFirst\(shelves\.learning\);\s*learnedPhrases = shelves\.learned;/, "the list is not split into the shelves");
    assert.match(bodyOf(page, "exportPhrases"), /const list = learningOf\(await listPhrases\(pair\)\);/, "a learned phrase gets into a TSV file");
    assert.match(page, /savedMeanings: \(normalized\) =>\s*Promise\.resolve\(phrases\.find\(\(one\) => one\.normalized === normalized\)\?\.translations \?\? \[\]\)/, "the look-up field reads a phrase's standing off something other than the learning shelf");
    assert.match(bodyOf(page, "showInList"), /segment = Segment\.LEARNING;/, "Show in list does not turn to the learning shelf");
  });

  it("gives a learned row back-to-learning and an armed deletion in the two slots Edit and Learned have", async () => {
    const page = await source("vocab/vocab.js");
    assert.match(bodyOf(page, "phraseRow"), /actions\.append\(\.\.\.\(isLearned\(phrase\) \? learnedActs\(phrase\) : learningActs\(phrase\)\)\);/, "the row's acts are not the shelf's");
    assert.match(bodyOf(page, "phraseRow"), /if \(editing === phrase\.normalized && !isLearned\(phrase\)\)/, "a learned row unfolds into the editor");
    const acts = bodyOf(page, "learnedActs");
    assert.match(acts, /back\.className = "quiet quiet-unlearn";/, "no back-to-learning button");
    assert.match(acts, /remove\.className = "quiet quiet-delete";/, "no Delete button");
    assert.match(acts, /if \(remove\.hasAttribute\("data-armed"\)\) void deleteOne\(phrase, remove\);\s*else armDelete\(remove, t\("reader_delete_confirm_aria", phrase\.phrase\)\);/, "Delete does not ask first");
    assert.match(bodyOf(page, "returnToLearning"), /kind: Message\.UNLEARN_PHRASE, text: phrase\.phrase/, "back to learning sends something else");
    assert.match(bodyOf(page, "deleteOne"), /kind: Message\.DELETE_PHRASE, text: phrase\.phrase/, "the deletion for good sends something else");
    assert.match(bodyOf(page, "forget"), /kind: Message\.FORGET_PHRASE, text: phrase\.phrase/, "Learned sends something else");
  });

  it("arms the shelf-wide deletion on the first press, sends it on the second, and stands every armed Delete down at a step away", async () => {
    const page = await source("vocab/vocab.js");
    assert.match(page, /if \(deleteLearnedButton\.hasAttribute\("data-armed"\)\) void deleteAllLearned\(\);\s*else armDelete\(deleteLearnedButton, plural\(learnedPhrases\.length, "vocab_delete_learned_confirm"\)\);/, "the shelf-wide deletion does not ask first");
    assert.match(bodyOf(page, "deleteAllLearned"), /kind: Message\.DELETE_LEARNED/, "the shelf-wide deletion sends something else");
    assert.match(bodyOf(page, "deleteAllLearned"), /status\(plural\(deleted, "vocab_deleted_learned"\)\);/, "the page does not say how many went");
    assert.match(bodyOf(page, "armDelete"), /button\.textContent = t\("reader_delete_confirm"\);/, "the armed button does not ask");
    assert.match(bodyOf(page, "armDelete"), /button\.style\.minWidth = `\$\{button\.offsetWidth\}px`;/, "the armed button does not hold its width");
    assert.match(page, /document\.addEventListener\("pointerdown", \(event\) => \{\s*const armed = armedDelete\(\);/, "a press elsewhere leaves a Delete armed");
    assert.match(page, /if \(event\.key === "Escape"\) disarmDelete\(\);/, "Escape leaves a Delete armed");
    assert.match(page, /document\.addEventListener\("focusout", \(event\) => \{\s*const armed = armedDelete\(\);/, "focus moving on leaves a Delete armed");
    assert.match(bodyOf(page, "renderLearnedActions"), /const shown = segment === Segment\.LEARNED && learnedPhrases\.length > 0;/, "the shelf-wide deletion stands on the wrong shelf, or over an empty one");
  });

  it("wears the counts on the shelf buttons and says the counter only while the filter narrows a shelf", async () => {
    const page = await source("vocab/vocab.js");
    const tabs = bodyOf(page, "renderSegments");
    assert.match(tabs, /t\("vocab_segment_learned_count", learnedPhrases\.length\.toLocaleString\(\)\)/, "the learned shelf's button carries no count");
    assert.match(tabs, /t\("vocab_segment_learning_count", phrases\.length\.toLocaleString\(\)\)/, "the learning shelf's button carries no count");
    const counter = bodyOf(page, "renderCount");
    assert.match(counter, /const filtering = filterActive\(query\) && rows\.length > 0;\s*countLine\.hidden = !filtering;/, "the counter stands beside the buttons' counts");
    assert.match(counter, /plural\(rows\.length, "vocab_count_filtered_learned", \[matching\.toLocaleString\(\)\]\)/, "the learned shelf's counter is not its own family");
  });

  it("dresses the shelf buttons as the reading list's, and an armed Delete in the accent", async () => {
    const styles = await source("vocab/vocab.css");
    assert.match(styles, /\n\.phrase-segments button\[aria-pressed="true"\] \{\s*border-color: var\(--page-accent\);/, "the pressed shelf button is not lit");
    assert.match(styles, /button\.quiet-delete\[data-armed\],[\s\S]*?button\.quiet-delete-all\[data-armed\][\s\S]*?\{\s*border-color: var\(--page-accent\);/, "an armed Delete is not in the accent");
    assert.match(styles, /\n\.learned-actions > button\.quiet \{\s*margin-block: 0;\s*min-height: 44px;/, "the shelf-wide act has no 44px box of its own");
  });

  it("keeps the three acts the phrases page's own - no content script, popup or look-up field sends them", async () => {
    for (const path of ["content/index.js", "content/tooltip.js", "content/launcher.js", "popup/index.js", "lib/lookup-box.js", "reader/reader.js"]) {
      const text = await source(path);
      assert.doesNotMatch(text, /UNLEARN_PHRASE|DELETE_PHRASE|DELETE_LEARNED/, `${path} sends a learned shelf act`);
    }
  });
});

describe("Learned as a state (D224) - the promises", () => {
  it("are kept in the README and PRIVACY: Learned keeps, the Learned list deletes", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const privacy = await readFile(new URL("../PRIVACY.md", import.meta.url), "utf8");
    assert.match(readme, /\*\*Back to learning\*\*/, "the README does not name the way back");
    assert.doesNotMatch(readme, /\*\*Learned\*\* removes the phrase|\*\*Learned\*\* deletes them/, "the README still says Learned deletes");
    assert.doesNotMatch(privacy, /Marking a phrase \*\*Learned\*\* deletes/, "PRIVACY still says Learned deletes");
    assert.match(privacy, /the day you marked a phrase \*\*Learned\*\*/, "PRIVACY does not name the day of the mark");
  });
});

describe("Learned as a state (D224) - the empty shelves", () => {
  it("says where everything went when the learning shelf is empty and the learned one is not", async () => {
    const page = await source("vocab/vocab.js");
    const sentence = bodyOf(page, "emptySentence");
    assert.match(sentence, /if \(segment === Segment\.LEARNED\) return t\("vocab_learned_empty", t\("bubble_learned"\)\);/, "the learned shelf's empty sentence is not its own");
    assert.match(sentence, /if \(learnedPhrases\.length > 0\) return t\("vocab_empty_all_learned", t\("bubble_save"\)\);/, "an emptied learning shelf claims nothing is saved");
    assert.match(sentence, /return t\("vocab_empty", t\("bubble_save"\)\);/, "a fresh vocabulary lost its sentence");
  });
});
