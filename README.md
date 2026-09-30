# re/read

A browser extension for reading - especially for reading in a language you are learning. Select a word or phrase to see its translation and save it; saved phrases are underlined on every page you visit, and one click marks a phrase as learned. Any page can be opened in the built-in reader and kept in the offline reading list; EPUB books can be imported and read the same way, translation bubble included. Everything is local: translation, dictionaries, vocabulary and the reading list are stored in the browser's local database on your device, work with no network, and nothing you read or select is ever sent anywhere.

Works in Firefox (desktop and Android) and in Chrome/Chromium. **Install it from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/reread/) or the [Chrome Web Store](https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla)** (Brave and Edge use the same page); the [Install](#install) section has the details.

![Two re/read windows side by side. Left: the offline reading list, split into To read and Read, with a search box and one row per saved article or book showing its length and how much of it is read. Right: the reader with a text divided into pages, the word "fossil" selected and the bubble under it showing the Polish translation, buttons to hear the word, copy it, edit it or mark it Learned, the sentence around it, and the entries from three dictionaries below that. Phrases saved earlier carry dotted underlines in the text](docs/screenshots/reading-list-and-reader.webp)

**Contents:** [Features at a glance](#features-at-a-glance) · [Features](#features) · [Reading without translation](#reading-without-translation) · [Install](#install) · [What it does not do](#what-it-deliberately-does-not-do) · [Privacy](#privacy) · [Third-party code](#third-party-code) · [Development](#development) · [Related projects](#related-projects) · [Licence](#licence) · [Feedback](#feedback) · [Support](#support) · [User guide](docs/GUIDE.md)

## Features at a glance

- Select a word or phrase on any page to see its translation in a bubble. The translation engine runs on your device.
- About a hundred language pairs, downloaded once from the settings page.
- Dictionaries next to the translation: more than four hundred WikDict pairs, or your own StarDict files.
- Save a phrase from the bubble. Saved phrases are underlined on every page you visit.
- Mark a phrase as learned with one click. It stays on a Learned list and can come back.
- A saved phrases page with filters, edits, counts, and TSV import and export, Anki included.
- A reader that shows any page as a clean article, with themes, fonts, and a Pages or Scroll layout.
- An offline reading list: saved articles open with no network, even after the original page is gone.
- EPUB books and Markdown files imported into the reading list and read the same way.
- A highlighter with notes, and a page that lists every highlight.
- Reading aloud with the device's offline voices, in the bubble and in the reader.
- Search inside a document and across the reading list.
- Export any saved document as EPUB or Markdown, and everything at once as one backup file.
- Works without a translation model: with dictionaries only, or in your own language.
- Interface in six languages. No account, no server, no telemetry.

The [user guide](docs/GUIDE.md) describes every screen, button and setting.

## Features

**Translation**

- **Bubble on selection.** Select a word or phrase to see its translation. The engine (Bergamot - the technology behind Firefox's built-in page translation) is included in the extension and runs on your device, so translation works with no network.
- **About a hundred language pairs.** Models are downloaded once from the settings page, or added from your own files, and stored locally. An installed pair shows an Update button when Mozilla publishes a new build.
- **Dictionaries beside the engine.** A translation model has to pick one meaning; a dictionary lists them all. StarDict dictionaries (a catalogue of more than four hundred WikDict pairs installable with one click, or your own files) appear in the bubble under the translation, and clicking a line attaches that meaning to the saved phrase.
- **Read aloud.** A phrase from the bubble, or a whole article or book in the reader, with the word being spoken highlighted, pause and resume, sentence skip and speed control. Only the device's offline voices are used.

**Vocabulary**

- **Underlines everywhere.** A saved phrase is underlined on every page where it appears; click the underline to see your meaning again. Matching is exact by default; one setting extends it to the other forms of a word that your dictionary confirms (English only for now).
- **Learned.** One click takes a phrase off every page and moves it to the **Learned** list on the saved phrases page, with everything stored for it. **Back to learning** brings it back; deleting a phrase for good is a separate act on that list.
- **Saved phrases page.** All your phrases on two lists, **To learn** and **Learned**, with filtering, editing, two counts per phrase (how often you checked it, and how often it occurred in the texts you finished) and ordering by either count, by date or alphabetically.
- **The sentence with the phrase.** An optional setting saves, with every phrase, the sentence it was selected in. The sentence is shown on the saved phrases page and goes into the Anki export.
- **Look up a word without a page.** A field in the toolbar popup shows your dictionaries' entries for a word you type; **Add a phrase** on the saved phrases page does the same and lets you save it.
- **TSV import and export.** Move vocabulary to Anki or between devices; importing the same file twice never duplicates a phrase. **Export for Anki** adds the sentence each phrase was saved in.

![Two windows. Left: the saved phrases page - the language pair, the To learn and Learned lists, a filter, and one row per phrase with its meaning, the sentence it was saved in, its two counts, and buttons to hear it, edit it or mark it Learned. Right: the highlights page - every highlight with its quote, the title of its document and the day it was made, and buttons to open it in the document, hear it, copy it, add a note or delete it](docs/screenshots/saved-phrases-and-highlights.webp)

**Reader and reading list**

- **Reader mode.** Opens the page as a clean article in the extension's own tab: from the right-click menu, from the bubble, with `Alt`+`Shift`+`R`, or from the toolbar popup. The reader's menu has the table of contents, search, full screen, export and a link to the original page.
- **Offline reading list.** A saved article is stored in full on your device and opens with no network, also when the original page is gone. Pages opened in the reader are saved by default; pictures are downloaded only on request. Every row shows the text's length and how long it takes at your reading speed.
- **EPUB books.** Import a book into the reading list and read it as one text, with its table of contents, footnotes and pictures. A long book is loaded part by part as you read on.
- **Markdown texts.** Import a `.md` file (a note from re/notes or Obsidian, or a document exported from the reader) and it joins the list like a book.
- **Reading position.** Every saved document reopens where you stopped.
- **Export a document.** Any saved article or book can be exported as an EPUB or a Markdown file, from the reader's menu or from a selection in the reading list. An exported `.md` file imports back.
- **Highlighter.** Highlights snap to whole words, can span paragraphs, come in four colours and take notes. A Highlights page lists every mark, exports them as Markdown, and keeps a highlight even when its article is deleted. A note can also be written on a whole document.
- **Search.** Inside the open document and across the reading list: titles, sites, your notes and, on request, the stored texts, with snippets.
- **Appearance.** Light, sepia, dark and e-ink themes; serif, sans or any font installed on the device; text size, column width, line spacing, left-aligned or justified lines, hyphenation, paragraph style, and links as plain text.
- **Pages or scroll.** The reader shows a text by whole pages (the default) or as one scrolling column. Pages are turned with keys, the mouse wheel or a finger, and a footer shows the reading progress. A page turn effect for e-ink screens can be a slide, a dark flash or nothing.

![Two windows. Left: an article in the reader - Mark as read and Delete above the title, then the author, the site the article came from with an icon that opens the original, its length with the number of saved phrases found in it, a line about its pictures with the Download and show in the text button, and a small bubble over another form of a saved word, naming the saved word. Right: the reader's menu - Contents, Search in text, Highlights, Mark as read, Download pictures, Export as EPUB, Export as Markdown, Delete from the reading list, Full screen, Saved phrases, Offline reading list, Open the original, Settings](docs/screenshots/article-and-menu.webp)

![Two windows. Left: a paragraph being highlighted in pink, with the pins at its ends and the highlighter's toolbar at the foot of the page - Copy, Note, the four colours, Delete, and the arrows that turn the page. Right: the reader's Aa panel - theme with E-ink among the choices, the Pages or Scroll layout, type, size, width, line spacing, alignment, hyphenation, paragraphs, links as plain text or active, the highlighter's colours, the underline, and the voice that reads aloud with its speed](docs/screenshots/highlighter-and-appearance.webp)

**Data and interface**

- **Local database.** Vocabulary, models, dictionaries, articles and books are stored in the browser's local extension storage (IndexedDB) on your device - no account, no sync, no server.
- **Safety copies.** Saved phrases, highlights and the reading list keep a second copy in the extension's own storage. If the browser ever clears the databases, they are restored from it automatically.
- **Backup.** **Export** on the reading list writes one `reread-backup.zip` with everything re/read keeps; **Import** reads it back, adding what is missing and never overwriting what is here. A selection of articles or books can be exported the same way, for sharing.
- **Toolbar popup.** Per-site off switch, language pair, a field to look up a word, and the reader, the reading list, the saved phrases and the settings in one place.
- **Six UI languages.** English, Polish, German, French, Spanish, Ukrainian.
- **Settings you can search.** The settings page is grouped into sections, with a table of contents beside it and a search field over it. Every setting has its own address (`#s-<name>`), so a link to one lands on it.
- **Custom CSS.** A field on the settings page takes CSS rules of your own for the bubble, the reader page and the toolbar popup - never for the pages you read. Rules that would load anything from the network are refused.

![Two windows of the settings page, each with the list of sections at the side and the Search the settings field at the top. Left: the Languages section - the language pair, the translation models with the one downloaded and the list to download from, the Use without a translation model switch, and the dictionaries with their order arrows. Right: the Bubble and phrases section, then Reading view - saving opened pages, a custom font, the reading speed - and Pages layout, with the page footer, turning pages by touch and the page turn effect](docs/screenshots/settings.webp)

## Reading without translation

re/read also works without machine translation. If you read in your own language, or with dictionaries instead of a translation model, one switch in the settings - **Use without a translation model** - turns the model off. The reader, the offline reading list, the highlighter, reading aloud and search all keep working, and so do dictionaries and saved phrases: selecting a word shows its dictionary meanings, ticking one saves the phrase, and saved phrases stay underlined wherever you read. Nothing is deleted; the model comes back as soon as you switch it on again.

A sub-option, **Do not show the bubble when selecting text**, is for people who select text to keep their place while reading: nothing appears on ordinary pages, and in the reader a selection only highlights the text. Details: [Reading without a translation model](docs/GUIDE.md#reading-without-a-translation-model) in the user guide.

## Install

- **Chrome or Chromium 128 or newer** - [re/read in the Chrome Web Store](https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla). Brave and Edge install it from the same page. This minimum comes from `document.caretPositionFromPoint`, which the extension needs to tell which underline a tap or a click landed on.
- **Firefox 142 or newer** - [re/read on addons.mozilla.org](https://addons.mozilla.org/firefox/addon/reread/), on desktop and on Android. This minimum comes from the CSS Custom Highlight API (used to underline phrases without changing the page's HTML) and from the manifest key that declares the extension collects no data.

### Firefox on Android

The same package works on Android, same version floor. The popup opens from the ⋮ menu, under **Extensions**.

On a phone the extension starts in **reader-only mode**: ordinary pages are left alone, and selecting text offers two actions - opening the page in the reader, where translation, saving and underlining work as usual, and going to the reading list. The reason: the translation bubble and Android's own copy menu compete for the same spot on the screen. The mode is a regular setting (**Show the underlines and the bubble only in the reader**) and can be switched off for the full desktop behaviour.

How to reach the reading list from a phone's start page, full screen on Android, and what a private tab does to the reading list: [Firefox on Android](docs/GUIDE.md#firefox-on-android) in the user guide.

## What it deliberately does not do

- **No accounts, no sync, no telemetry, no analytics.** There is no server.
- **No flashcards or spaced repetition.** Export your vocabulary to TSV - with the sentence each phrase was saved in, if you keep it - and use Anki; it does this better.
- **Matching is literal by default.** Saving `read` does not underline `reading` unless you turn on **Underline other forms of saved words** in the settings - and then only the forms your dictionary for the language confirms, for English only so far. No guessing by rule alone, and no forms for a word your dictionaries do not know.
- **Nothing inside embedded frames.** The extension works in the page you opened, not in embedded ads, players or widgets.
- **No remote code.** Everything that runs ships in the package (Manifest V3 enforces this anyway).
- **Books are imported as text and pictures only.** EPUB import takes the text and the pictures in the file: no publisher styling, no fonts, and no DRM - a protected book is not imported, and a message says why. Links inside the book's text are not followed. How the table of contents and the footnotes are read: [EPUB books](docs/GUIDE.md#epub-books) in the user guide.

## Privacy

The extension connects to two servers whose addresses are built into the extension:

- Mozilla's storage bucket - the list of translation models and the models themselves,
- WikDict - the list of dictionaries and the dictionaries themselves.

Every request to them happens only when you click a button on the settings page; each list shows the date it was fetched, and download addresses are always taken from the copy inside the extension, never from a web page.

Requests to addresses that are not built in happen only when you ask for them. **Add a dictionary from a link** on the settings page downloads a dictionary archive from the address you paste there - once, without cookies, when you press **Download**; the address is yours, the extension suggests none, and a link is followed wherever its host sends it, which the page then says. **Download pictures**, a row in the reader's menu over a saved article, downloads that article's pictures from the addresses the pictures point at - the site the article came from, its image server, or another site the page embedded a picture from - once, without cookies or referrer, and only when you press it. The extension never downloads a picture on its own; a saved article contains only text until you press that row. Page text, your selections and your vocabulary never leave the device.

You can check this instead of trusting it: watch the network panel in the browser's developer tools, read the source code (published unminified), or simply turn the network off - translation, dictionaries and the reading list keep working. A test in the repository (`test/network-sinks.test.js`) lists every place in the code that can reach the network and fails the build when one is added.

The **Custom CSS** field on the settings page is not a way around this: the rules you type dress only the extension's own pages - the bubble, the reader and the toolbar popup - never the page you are reading, and a rule that would load anything from the network (`url()`, `@import`, `@font-face`) is refused before it is stored.

One thing a web page can see: on a page where your saved phrases are underlined, the page's own scripts can tell that re/read is installed and which of the page's words are underlined - the underlines are drawn with the browser's highlight registry, which the page shares. Nothing else is visible to it: not your vocabulary, not the bubble, not what you save. The **Show the underlines and the bubble only in the reader** setting keeps ordinary pages free of underlines altogether, so with it on no page can tell.

The same, written in the form the add-on stores require, in one document without legal language: [`PRIVACY.md`](PRIVACY.md).

Everything the extension stores - vocabulary, translation models, dictionaries, saved articles and books, settings - is stored in the browser's local extension storage on your device and is never synced anywhere: four IndexedDB databases (`reread-vocab`, `reread-articles`, `reread-dicts`, `reread-models`) and the extension's `storage.local`, which holds the settings and the safety copies of the vocabulary, the highlights and the reading list. You can look at all of it in the browser's developer tools, under the extension's own origin (Firefox: Storage; Chrome: Application). In particular:

- Switching re/read off for a site stores that site's hostname locally. Entries are listed and removable on the settings page.
- Saving an article stores its title, address and extracted text, so it opens with no network. Its pictures are stored only when you press **Download and show in the text** under the article's title or **Download pictures** in the reader's menu (scaled down to screen size where that saves space); **Remove pictures** in the same menu deletes them again. A book imported from an `.epub` file stores the pictures the file holds, scaled down the same way, with no network involved. The reading list shows how many pictures an article or a book has and how much space they take. Deleting an entry removes everything stored for it - text, pictures, highlights and notes, reading position - from the database and from the reading list's safety copy. Saved phrases are not part of an entry: a phrase you saved while reading an article stays in your vocabulary, with no record of where it came from, until you delete it from the **Learned** list on the saved phrases page. Marking a phrase **Learned** does not delete it: it stores the day you did and moves the phrase to that list, with everything stored for it.
- Two counts are kept with each saved phrase: how many times you opened its bubble, and how many times it occurred in the texts you finished in the reader (a book's text as you read on past it, an article marked as read), each with the time it last happened. No page, title or text is stored with them - only how often. **Learned** keeps them; deleting the phrase from the Learned list deletes them with it.
- Reading aloud uses the browser's own speech synthesis (the standard Web Speech API), and only its offline voices: a voice that would send the text to the browser maker's server to be spoken (Chrome's "Google ..." voices, Edge's "... Online" ones - `localService: false`) is not shown in any voice list and is never used. Which speech engine is used is a browser/OS setting; the extension itself makes no network request for reading aloud.
- Telling which language a selected phrase is in, before it is translated, uses the browser's built-in detector (`i18n.detectLanguage`, Compact Language Detector: CLD2 compiled into Firefox, CLD3 compiled into Chromium) - on the device, with no model download and no request; the text never leaves the browser. It is handed at most one sentence, the one around the selection, cut to 400 characters. Safari has no such detector, and re/read then skips the check. We re-check both browsers' source code with every release; [`PRIVACY.md`](PRIVACY.md) says what we can and cannot promise about it.

### Permissions

| Permission | Why |
|---|---|
| `storage` | Vocabulary and settings. Browser-local, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and dictionaries can be more; the default quota is not enough. |
| `<all_urls>` | Saved phrases are underlined on **every** page, so the content script must run everywhere. This is a broad permission: it means the extension can read the pages you visit. It reads them locally to find your saved phrases, and sends nothing. |
| `contextMenus` | The **re/read** entries in the right-click menu - **Open in reading view** and **Offline reading list** - on any web page, for whoever never pinned the toolbar button. It adds two rows to the browser's menu and reads nothing; neither store asks for consent for it. |
| `offscreen` (Chromium package only) | Chromium runs the extension's background as a service worker, which cannot start the Web Worker the translation engine runs in. A single hidden document (offscreen document) runs that worker instead; it grants no access to any page or data. Firefox needs no equivalent and its package does not include this permission. |

There is nothing else - no `tabs`, no `webRequest`, no `cookies`, no `downloads`. The popup finds out which site it is on by asking the extension's own script already running on that page, not through the `tabs` API.

## Third-party code

Three components, all committed to the repository with their licence, provenance and SHA-256 checksums next to them. `tools/check-vendor.sh` verifies the checksums on every run of the quality gate.

- **[Bergamot](https://github.com/browsermt/bergamot-translator)** (MPL-2.0) - the translation engine: Marian NMT compiled to WebAssembly. Manifest V3 forbids remotely hosted code, so the engine is included in the extension package; this is also why the manifest declares `'wasm-unsafe-eval'` in its content security policy. Details: [`vendor/bergamot/README.md`](vendor/bergamot/README.md).
- **[Readability](https://github.com/mozilla/readability)** (Apache-2.0) - the article extractor behind Firefox's reader view, used by the reader mode. It runs on a separate, inactive copy of the page created with `DOMParser`, and its output is rebuilt from a list of allowed elements and attributes (never inserted as `innerHTML`), also every time a saved article is opened. Details: [`vendor/readability/README.md`](vendor/readability/README.md).
- **[fflate](https://github.com/101arrowz/fflate)** (MIT) - the ZIP reader behind EPUB import, the readable unminified build. Loaded by the reader page only when a book import starts, and only its synchronous single-entry API is used - chapters are unpacked one at a time, and the part of the library that starts worker threads is never called. Details: [`vendor/fflate/README.md`](vendor/fflate/README.md).

Besides those three, one table: `src/lib/dict/entities.js` is the [HTML standard's list of named character references](https://html.spec.whatwg.org/multipage/named-characters.html) (WHATWG, CC BY 4.0), generated by `tools/entities.mjs` from the standard's `entities.json`. It is what turns a dictionary entry's `&lsqb;`, `&rarr;` or `&frac12;` into the character its author meant, every name the standard has rather than a list of the ones met so far.

### Translation models

Models are Mozilla's own (MPL-2.0) - the same ones Firefox's page translation uses - downloaded from Mozilla's published storage bucket. The list of available models is Mozilla's index, fetched from an address written into the package; a copy included in the extension ([`src/lib/models/registry.json`](src/lib/models/registry.json)) makes the extension work offline from the first start.

Every download is verified before it is stored: declared sizes, Mozilla's published SHA-256, and a trial load in a fresh copy of the engine. Anything that fails is discarded. Downloads happen on the settings page, need no extra permissions, and can be cancelled.

### Dictionaries

Supported format: **StarDict** (`.ifo`, `.idx`, `.dict`/`.dict.dz`, optional `.syn`) - the same format [KOReader](https://koreader.rocks/) uses, so dictionaries can be shared between your e-reader and browser.

The settings page carries a catalogue of more than four hundred [WikDict](https://www.wikdict.com/) pairs (CC BY-SA, built from Wiktionary); one click downloads and installs a dictionary. A dictionary from anywhere else - a monolingual one, English-English for example - you add yourself: from files, or by pasting the address of its `.zip` archive under **Add a dictionary from a link** (the sources we know of, each stating its licence, are listed at [reapps.eu/read](https://reapps.eu/read#faq-dictionary-sources)). Dictionary downloads have no fixed checksum to compare against (WikDict rebuilds its files in place), but every archive is checked - a plain zip of StarDict files, with sizes and CRCs verified - and read carefully once, when it is added. Attribution is kept and shown on the settings page.

Dictionaries are matched by the language of their headwords, not by the pair, so a monolingual dictionary is shown next to the bilingual ones. How the entries are shown in the bubble, the language check before the model is asked, the order of several dictionaries and their display names: [The bubble and the underlines](docs/GUIDE.md#the-bubble-and-the-underlines) and [Dictionaries](docs/GUIDE.md#dictionaries) in the user guide.

For English-Polish, WikDict is the recommended start: 66,609 entries plus 51,721 alternative spellings in its `.syn` file (which is what lets `elevations` find `elevation`). FreeDict's `eng-pol` StarDict build (release 0.2.1) is mostly missing the Polish translations (checked 2026-08-11); other FreeDict pairs may be fine.

## Development

Plain JavaScript with JSDoc types (TypeScript as a checker only, `--noEmit`), bundled by esbuild because content scripts cannot be ES modules, shipped unminified. No runtime dependencies beyond the three vendored components above.

```bash
npm install
npm run build            # Firefox package in dist/firefox
npm run build:chromium   # Chromium package in dist/chromium
npm run build:safari     # Safari package in dist/safari, synced into safari/ (see below)
tools/check.sh           # quality gate: vendor checksums, typecheck, tests, all builds, addons-linter
```

`tools/check.sh` is exactly what CI runs. A build loads as a temporary extension in Firefox (`about:debugging`) or an unpacked one in Chrome (`chrome://extensions` → Load unpacked → `dist/chromium`). The practical notes - AMO signing for a build that survives a Firefox restart, quirks of unpacked Chrome loads, regenerating the model registry and the dictionary catalogue, code layout - are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

**Safari (iOS/iPadOS, experimental - not yet in the App Store):** Safari installs extensions only inside a native app, so `safari/` holds a minimal Xcode wrapper - one screen that says what the extension is and how to turn it on, a required no-op message handler, nothing else. `npm run build:safari` builds the same extension for Safari (the manifest differences are in `tools/manifest-target.mjs`, like Chromium's) and syncs it into the wrapper's gitignored `Resources/` directory; then `safari/reread.xcodeproj` builds and runs it on a device from Xcode. Verified on an iPad Pro (2018); requires Safari 18.2+ for detecting taps on underlines - on older versions that part does not work, the rest does.

## Related projects

By the same foundation:

- **[re/apps](https://github.com/fundacja-reborn/reapps)** - open-source, end-to-end encrypted productivity apps: **[re/notes](https://reapps.eu/notes)** (notes and documents in Markdown) and **[re/task](https://reapps.eu/task)** (task management). All data is encrypted on your device before it reaches the server.
- **[offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin)** - offline translation while reading for [KOReader](https://koreader.rocks/), an open-source e-book reader popular on e-ink devices. It uses the same TSV format for saved phrases, so vocabulary collected on an e-reader can be imported here and underlined in your browser, and vice versa.

## Licence

[AGPL-3.0-or-later](LICENSE), the same as the KOReader plugin it exchanges files with.

## Feedback

Found a bug, missing something, or want to say how re/read works for you? [Open an issue](https://github.com/fundacja-reborn/reread-webext/issues), or write to [@reapps_eu on Mastodon](https://mastodon.social/@reapps_eu). Both go straight to the people who make it - the switches that turn off reading aloud and the bubble came from exactly such a message.

A security problem - anything that could make what you read leave your device, or let a page run code inside the extension - goes through private reporting, not a public issue: see [SECURITY.md](SECURITY.md).

## Support

re/read is built by a non-profit foundation - no investors, no ads, no tracking. If you find it useful and want to support its continued development, every donation helps us build software free from commercial pressure.

→ [**Donate via Wise**](https://wise.com/pay/business/fundacjareborn?description=Donation+-+statutory+purposes)

→ [**More ways to support**](https://reapps.eu/#support)

→ [**Rate re/read on addons.mozilla.org**](https://addons.mozilla.org/firefox/addon/reread/reviews/) or [**on the Chrome Web Store**](https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla/reviews) - a rating costs nothing and helps other readers find it. The same links are on the settings page, under Support, aimed at the store your browser installed from.

---

Built with privacy in mind by [Fundacja Reborn](https://reborn.org.pl) (Poland).
