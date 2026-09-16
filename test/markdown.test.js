import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMarkdown } from "../src/lib/book/markdown.js";

/** @param {string} text @returns {string} */
const html = (text) => parseMarkdown(text).html;

describe("parseMarkdown", () => {
  describe("the text's own facts", () => {
    it("takes the first heading as the title and leaves it out of the text", () => {
      const parsed = parseMarkdown("# A *long* article\n\nBody.\n\n# Another\n");
      assert.equal(parsed.title, "A long article");
      assert.equal(parsed.html, "<p>Body.</p><h1>Another</h1>");
    });

    it("keeps a level-one heading that does not open the text", () => {
      const parsed = parseMarkdown("Intro.\n\n# Later\n");
      assert.equal(parsed.title, null);
      assert.equal(parsed.html, "<p>Intro.</p><h1>Later</h1>");
    });

    it("reads a front matter block for the title, the author and the language, and drops it", () => {
      const parsed = parseMarkdown('---\ntitle: "Notes on X"\nauthor: Someone\nlanguage: en\ntags: [a, b]\n---\n\nBody.\n');
      assert.deepEqual(parsed, { html: "<p>Body.</p>", title: "Notes on X", author: "Someone", lang: "en" });
      // The heading wins over the front matter: it is what the reader sees.
      assert.equal(parseMarkdown("---\ntitle: Meta\n---\n# Shown\n\nBody.").title, "Shown");
    });

    it("reads a rule at the top as a rule when no front matter closes it, or nothing stands in it", () => {
      assert.equal(html("---\n\nBody.\n"), "<hr><p>Body.</p>");
      assert.equal(html("---\n---\nBody.\n"), "<hr><hr><p>Body.</p>");
    });

    it("reads nothing as nothing", () => {
      assert.deepEqual(parseMarkdown(""), { html: "", title: null, author: null, lang: null });
      assert.equal(html("\n\n   \n"), "");
    });
  });

  describe("blocks", () => {
    it("reads headings of both kinds", () => {
      assert.equal(html("## Two\n\n###### Six ##\n\n#hashtag\n\nSetext\n===\n\nOther\n---\n"), "<h2>Two</h2><h6>Six</h6><p>#hashtag</p><h1>Setext</h1><h2>Other</h2>");
    });

    it("reads paragraphs with soft and hard breaks, leading air stripped", () => {
      assert.equal(html("One\n   two  \nthree\\\nfour\n\nFive"), "<p>One\ntwo<br>three<br>four</p><p>Five</p>");
    });

    it("reads quotes, nested, with a lazy continuation line", () => {
      assert.equal(html("> One\ncontinued\n>\n> > Deep\n\nOut"), "<blockquote><p>One\ncontinued</p><blockquote><p>Deep</p></blockquote></blockquote><p>Out</p>");
    });

    it("reads fenced and indented code as it stands", () => {
      assert.equal(
        html("```js\nlet a = *1*;\n\n  b();\n```\n\n~~~\n```\n~~~\n\n    indented <x>\n    more\n\nafter"),
        "<pre><code>let a = *1*;\n\n  b();</code></pre><pre><code>```</code></pre><pre><code>indented &lt;x&gt;\nmore</code></pre><p>after</p>",
      );
      // An unclosed fence runs to the end; a fence's own indentation is
      // taken off its lines.
      assert.equal(html("  ```\n  a\n   b"), "<pre><code>a\n b</code></pre>");
    });

    it("reads thematic breaks, and a setext underline where a paragraph precedes", () => {
      assert.equal(html("***\n\n- - -\n\n___\n\nText\n---\n"), "<hr><hr><hr><h2>Text</h2>");
    });

    it("reads bullet lists, tight and loose, nested by indentation", () => {
      assert.equal(html("- one\n- two\n  - deep\n- three"), "<ul><li>one</li><li>two<ul><li>deep</li></ul></li><li>three</li></ul>");
      assert.equal(html("- one\n\n- two"), "<ul><li><p>one</p></li><li><p>two</p></li></ul>");
      assert.equal(html("- one\n  lazy\n\n  second paragraph\n- two"), "<ul><li><p>one\nlazy</p><p>second paragraph</p></li><li><p>two</p></li></ul>");
    });

    it("reads numbered lists from where they start, and a change of marker as a new list", () => {
      assert.equal(html("3. three\n4. four\n\n1) one\n* star\n- dash"), '<ol start="3"><li>three</li><li>four</li></ol><ol><li>one</li></ol><ul><li>star</li></ul><ul><li>dash</li></ul>');
    });

    it("keeps a code block inside an item, blank lines and all, without loosening the list", () => {
      assert.equal(html("- item\n  ```\n  a\n\n  b\n  ```\n- next"), "<ul><li>item<pre><code>a\n\nb</code></pre></li><li>next</li></ul>");
    });

    it("reads a list inside a quote, and a quote inside a list", () => {
      assert.equal(html("> - a\n> - b"), "<blockquote><ul><li>a</li><li>b</li></ul></blockquote>");
      assert.equal(html("- > q"), "<ul><li><blockquote><p>q</p></blockquote></li></ul>");
    });

    it("reads a table with or without its outer bars, cells padded and cut to the head", () => {
      assert.equal(
        html("| a | b |\n|---|:-:|\n| 1 |\n| 2 | 3 | 4 |\n\nafter"),
        "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr><tr><td>2</td><td>3</td></tr></tbody></table><p>after</p>",
      );
      assert.equal(html("a | b\n--- | ---\nx \\| y | *z*"), "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x | y</td><td><em>z</em></td></tr></tbody></table>");
      // A head and a delimiter row that disagree on their cells are no table.
      assert.equal(html("a | b\n---\n"), "<h2>a | b</h2>");
    });

    it("passes a block of HTML through, for the sanitizer to judge", () => {
      assert.equal(html("<div class=\"x\">\n<p>raw *not em*</p>\n</div>\n\nafter"), '<div class="x">\n<p>raw *not em*</p>\n</div><p>after</p>');
      assert.equal(html("<script>alert(1)</script>"), "<script>alert(1)</script>");
    });

    it("normalizes line endings and tabs", () => {
      assert.equal(html("a\r\nb\r\n\r\n\t- not code, a tab is four spaces"), "<p>a\nb</p><pre><code>- not code, a tab is four spaces</code></pre>");
    });
  });

  describe("inline", () => {
    it("reads emphasis of both characters, strong and both, inside a word too", () => {
      assert.equal(html("*em* **strong** ***both*** _em_ __strong__ un*believ*able"), "<p><em>em</em> <strong>strong</strong> <em><strong>both</strong></em> <em>em</em> <strong>strong</strong> un<em>believ</em>able</p>");
    });

    it("leaves what the flanking rules do not allow as it is", () => {
      assert.equal(html("snake_case_name and 5 * 3 * 2 and * not em *"), "<p>snake_case_name and 5 * 3 * 2 and * not em *</p>");
      assert.equal(html("a *b\n\nc* d"), "<p>a *b</p><p>c* d</p>");
    });

    it("keeps the rule of three", () => {
      assert.equal(html("*foo**bar**baz*"), "<p><em>foo<strong>bar</strong>baz</em></p>");
      assert.equal(html("**foo*bar*baz**"), "<p><strong>foo<em>bar</em>baz</strong></p>");
    });

    it("reads strikethrough as two tildes and one tilde as itself", () => {
      assert.equal(html("~~gone~~ ~one~"), "<p><del>gone</del> ~one~</p>");
    });

    it("reads code spans, longer runs and padding included, and escapes what they hold", () => {
      assert.equal(html("`a *b*` `` c`d `` `` `e` `` ``` `` ```"), "<p><code>a *b*</code> <code>c`d</code> <code>`e`</code> <code>``</code></p>");
      assert.equal(html("`<x> & y`"), "<p><code>&lt;x&gt; &amp; y</code></p>");
      assert.equal(html("a ` b"), "<p>a ` b</p>");
    });

    it("reads links of every shape", () => {
      assert.equal(html('[a](https://x.test/a "T") [b](<https://x.test/b c>) [c][ref] [ref][] [ref]\n\n[ref]: https://x.test/r'), '<p><a href="https://x.test/a">a</a> <a href="https://x.test/b c">b</a> <a href="https://x.test/r">c</a> <a href="https://x.test/r">ref</a> <a href="https://x.test/r">ref</a></p>');
      assert.equal(html("[none][missing] and [x]"), "<p>[none][missing] and [x]</p>");
      assert.equal(html("[paren](https://x.test/a_(b)) and [esc](https://x.test/\\))"), '<p><a href="https://x.test/a_(b)">paren</a> and <a href="https://x.test/)">esc</a></p>');
    });

    it("reads autolinks in angle brackets, bare addresses, and mail", () => {
      assert.equal(html("<https://x.test/p?q=1> and <me@x.test>"), '<p><a href="https://x.test/p?q=1">https://x.test/p?q=1</a> and <a href="mailto:me@x.test">me@x.test</a></p>');
      assert.equal(html("See https://x.test/a_(b). (https://x.test/c) https://x.test/d, end"), '<p>See <a href="https://x.test/a_(b)">https://x.test/a_(b)</a>. (<a href="https://x.test/c">https://x.test/c</a>) <a href="https://x.test/d">https://x.test/d</a>, end</p>');
      assert.equal(html("nothttps://x.test/a"), "<p>nothttps://x.test/a</p>");
    });

    it("holds no link inside a link", () => {
      // The inner link is made first and the outer bracket is then only a
      // bracket; what follows it is text, in which the bare address is
      // still an address - the autolink extension's own reading.
      assert.equal(html("[https://x.test/a](https://x.test/a) [[in](https://x.test/b) out](https://x.test/c)"), '<p><a href="https://x.test/a">https://x.test/a</a> [<a href="https://x.test/b">in</a> out](<a href="https://x.test/c">https://x.test/c</a>)</p>');
    });

    it("reads images, inline and by reference", () => {
      assert.equal(html('![A *photo*](https://x.test/p.jpg "t") ![r][pic]\n\n[pic]: https://x.test/r.png'), '<p><img src="https://x.test/p.jpg" alt="A photo"> <img src="https://x.test/r.png" alt="r"></p>');
    });

    it("reads the double-bracket links of the notes apps as their words, and drops their embeds", () => {
      assert.equal(html("See [[Other note]] and [[Target|the alias]], not ![[picture.png]] here"), "<p>See Other note and the alias, not  here</p>");
    });

    it("reads footnotes, numbered by first use, their text flat, defined anywhere", () => {
      assert.equal(
        html("Second[^b] and first[^a], again[^b].\n\n[^a]: The *first* note\n    goes on.\n[^b]: Second.\n[^c]: Unused."),
        '<p>Second<a data-note="Second.">1</a> and first<a data-note="The first note goes on.">2</a>, again<a data-note="Second.">1</a>.</p>',
      );
      assert.equal(html("Missing[^x]."), "<p>Missing[^x].</p>");
      // A reference inside a note's own text is words, not a note in a note.
      assert.equal(html("A[^1]\n\n[^1]: sees [^2]\n[^2]: other"), '<p>A<a data-note="sees [^2]">1</a></p>');
    });

    it("passes inline HTML and entities through, and escapes the bare characters", () => {
      assert.equal(html("a <b>bold</b> &copy; &amp; & < > \"q\" <notatag"), "<p>a <b>bold</b> &copy; &amp; &amp; &lt; &gt; &quot;q&quot; &lt;notatag</p>");
      // A comment opening a line opens an HTML block, the rest of the line
      // included - the grammar's reading, and the sanitizer drops the
      // comment either way.
      assert.equal(html("<!-- a comment --> x"), "<!-- a comment --> x");
      assert.equal(html("text <!-- inside --> x"), "<p>text <!-- inside --> x</p>");
    });

    it("reads backslash escapes", () => {
      assert.equal(html("\\*not em\\* \\\\ \\# \\[x\\] a\\b"), "<p>*not em* \\ # [x] a\\b</p>");
    });

    it("keeps Unicode punctuation on the right side of the rules", () => {
      assert.equal(html("*„quoted”* and **bold**, done"), "<p><em>„quoted”</em> and <strong>bold</strong>, done</p>");
    });
  });
});
