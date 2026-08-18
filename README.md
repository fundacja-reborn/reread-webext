# re/read

A browser extension for reading in a language you are learning. Select a word or phrase to see its translation and save it. Saved phrases are underlined on every page you visit; one click marks a phrase as learned and removes the underline. Any page can also be saved to the **offline reading list**: the article text is stored on your device, ready to browse and read later with no network — in the extension's clean reading view, where selecting and translating phrases works as usual. Everything is local: translation, dictionaries and the reading list work offline, and nothing you read or select is ever sent anywhere.

**Contents:** [Offline by design](#offline-by-design) · [Status](#status) · [Keyboard shortcuts](#keyboard-shortcuts) · [What it does not do](#what-it-deliberately-does-not-do) · [Privacy](#privacy) · [Third-party code](#third-party-code) · [Requirements](#requirements) · [Development](#development) · [Licence](#licence) · [Support](#support)

Sister project of [offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin), which does the same for [KOReader](https://koreader.rocks/) — an open-source e-book reader, popular on e-ink devices. Both use the same TSV format for saved phrases, so vocabulary can be moved between them by export and import: phrases collected on an e-reader get underlined in your browser, and vice versa.

## Offline by design

- **Translation is local.** The translation engine ships inside the extension; language models are downloaded once and stored on your device. No server is involved, so translation works even in airplane mode.
- **The reading list stores full copies.** A saved article opens without network and keeps working when the original page has moved or disappeared.
- **Vocabulary is a local database.** No account, no sync, no server.

The extension uses the network in exactly two cases, both started manually on the settings page: downloading a translation model or a dictionary, and refreshing their lists. Both connect only to the two addresses hardcoded in the package. How to verify this: see [Privacy](#privacy).

## Status

**Early version.** What works today:

| Feature | State |
|---|---|
| Firefox: translation bubble on selected text | ✓ |
| Translation engine (Bergamot, bundled, fully offline) | ✓ |
| Translation models: downloaded on request or added from files | ✓ |
| Saving phrases, editing their meaning, marking as learned | ✓ |
| Underlining saved phrases on the pages you read | ✓ |
| Reading a phrase aloud (browser's built-in voices, voice per language configurable) | ✓ |
| Reading a whole article aloud in the reader (live highlighting, pause/resume, sentence skip, speed) | ✓ |
| StarDict dictionaries: WikDict catalogue or your own files | ✓ |
| Reader mode (opens the page as a clean article in the extension's own tab) | ✓ |
| Offline reading list (articles saved from the reader) | ✓ |
| Reading position: every saved document reopens where you stopped | ✓ |
| Highlighter in the reader (word-snapped marks, across paragraphs, kept with the saved copy) | ✓ |
| EPUB books in the reading list (imported from a file, cut into parts, read with the full bubble) | ✓ |
| Saved phrases page (filter, pagination, edit and Learned per row) | ✓ |
| Toolbar popup (per-site switch, language pair, reader, reading list, phrases, settings) | ✓ |
| UI languages: English, Polish, German, French, Spanish, Ukrainian | ✓ |
| Import/export: vocabulary as TSV, reading list as JSON | ✓ |
| Firefox on Android | builds, reader-only by default, not yet tested on a phone |
| Chrome / Chromium (desktop) | ported: service worker background, engine in an offscreen document, raster icons; loads unpacked, not yet smoke-tested |

## Keyboard shortcuts

| Key | Where | Action |
|---|---|---|
| `Alt`+`Shift`+`R` | any page | open the page in the reader |
| `Esc` | any page | close the translation bubble |
| `Space` | reader, during read-aloud | pause / resume |
| `←` `→` | reader, during read-aloud | previous / next sentence |
| `<` `>` | reader, during read-aloud | slower / faster |

The read-aloud keys work only while the voice is reading; otherwise the page behaves normally (Space scrolls as usual). Keys pressed inside text fields or on focused buttons are left alone.

## What it deliberately does not do

- **No accounts, no sync, no telemetry, no analytics.** There is no server.
- **No flashcards or spaced repetition.** Export your vocabulary to TSV and use Anki — it does this better.
- **No inflection matching.** Matching is literal: saving `read` does not underline `reading`.
- **Nothing inside embedded frames.** The extension works in the page you opened, not in embedded ads, players or widgets.
- **No remote code.** Everything that runs ships in the package (Manifest V3 enforces this anyway).
- **Not an e-book reader.** EPUB import exists so you can read prose with the translation bubble: text only — no images, no publisher styling, no footnote navigation, and no DRM (a protected book is refused with a plain message). A table of contents is built from the chapter headings in the text itself; the book's own TOC page and internal links are not followed. Books stay out of the reading-list export; the backup of a book is its `.epub` file.

## Privacy

The extension connects to exactly two hosts, both written into the package:

- Mozilla's storage bucket — the list of translation models and the models themselves,
- WikDict — the list of dictionaries and the dictionaries themselves.

Every request happens only when you click it, on the settings page; each list shows the date it was fetched, and download addresses are always taken from the packaged sources, never from the page. Page text, your selections and your vocabulary never leave the device.

You can verify this instead of trusting it: watch the network panel in devtools, read the source (shipped unminified), or simply turn the network off — translation, dictionaries and the reading list keep working.

Other data stored locally:

- Switching re/read off for a site stores that site's hostname in the browser's local extension storage. Entries are listed and removable on the settings page.
- Saving an article to the reading list stores its title, address and extracted text locally, so it opens with no network. Deleting an entry removes it completely.
- Reading aloud uses the browser's own speech synthesis (the standard Web Speech API). Which engine speaks is a browser/OS setting; the extension itself makes no network request for it.

### Permissions

| Permission | Why |
|---|---|
| `storage` | Vocabulary and settings. Browser-local, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and dictionaries can be more; the default quota is not enough. |
| `<all_urls>` | Saved phrases are underlined on **every** page, so the content script must run everywhere. This is a broad permission: it means the extension can read the pages you visit. It reads them locally to find your saved phrases, and sends nothing. |
| `offscreen` (Chromium package only) | Chromium runs the extension's background as a service worker, which cannot spawn the Web Worker the translation engine runs in. The one offscreen document hosts that worker; it grants no access to any page or data. Firefox needs no equivalent and its package does not carry this permission. |

There is nothing else — no `tabs`, no `webRequest`, no `cookies`, no `downloads`. The popup learns which site it is on by asking the content script already running there, not through the `tabs` API.

## Third-party code

Three components, all committed to the repository with their licence, provenance and SHA-256 checksums next to them. `tools/check-vendor.sh` verifies the checksums on every run of the quality gate.

- **[Bergamot](https://github.com/browsermt/bergamot-translator)** (MPL-2.0) — the translation engine: Marian NMT compiled to WebAssembly. Manifest V3 forbids remotely hosted code, so the engine ships inside the package; this is also why the manifest declares `'wasm-unsafe-eval'` in its content security policy. Details: [`vendor/bergamot/README.md`](vendor/bergamot/README.md).
- **[Readability](https://github.com/mozilla/readability)** (Apache-2.0) — the article extractor behind Firefox's reader view, used by the reader mode. It runs on an inert copy of the page parsed by `DOMParser`, and its output is rebuilt from a list of allowed elements and attributes (never assigned as `innerHTML`), also every time a saved article is opened. Details: [`vendor/readability/README.md`](vendor/readability/README.md).
- **[fflate](https://github.com/101arrowz/fflate)** (MIT) — the ZIP reader behind EPUB import, the readable unminified build. Loaded lazily by the reader page the moment a book import starts, and only its synchronous single-entry API is used — chapters are inflated one at a time, and the asynchronous worker-spawning half of the library is never called. Details: [`vendor/fflate/README.md`](vendor/fflate/README.md).

### Translation models

Models are Mozilla's own (MPL-2.0) — the same ones Firefox's page translation uses — downloaded from Mozilla's published storage bucket. The list of available models is Mozilla's index, fetched from an address written into the package; a packaged snapshot ([`src/lib/models/registry.json`](src/lib/models/registry.json)) makes the extension work offline from day one.

Every download is verified before it is stored: declared sizes, Mozilla's published SHA-256, and a trial load in a fresh copy of the engine. Anything that fails is discarded. About a hundred language pairs are available; when Mozilla publishes a new build of an installed pair, its row shows an Update button.

Downloads happen on the settings page, need no extra permissions, and can be cancelled.

### Dictionaries

A translation model has to pick one meaning — *bank* is a riverbank or a place that keeps money, never both. A dictionary lists all meanings, so dictionaries complement the engine.

Supported format: **StarDict** (`.ifo`, `.idx`, `.dict`/`.dict.dz`, optional `.syn`) — the same format [KOReader](https://koreader.rocks/) uses, so dictionaries can be shared between your e-reader and browser.

The settings page carries a catalogue of about five hundred [WikDict](https://www.wikdict.com/) pairs (CC BY-SA, built from Wiktionary); one click downloads and installs a dictionary. You can also add StarDict files by hand. Dictionary downloads carry no pinned checksum (WikDict rebuilds its files in place), but every archive is validated — a plain zip of StarDict files, with sizes and CRCs checked — and parsed defensively once, when it is added. Attribution is kept and shown on the settings page.

Dictionary entries appear under **More** in the bubble; clicking a line adds that meaning to the saved phrase, clicking again removes it.

For English–Polish, WikDict is the recommended start: 66 609 entries plus 51 721 alternative spellings in its `.syn` file (which is what lets `elevations` find `elevation`). Note: FreeDict's `eng-pol` StarDict build (release 0.2.1) is mostly missing the Polish translations — checked 2026-08-11; other FreeDict pairs may be fine.

## Requirements

Firefox 142 or newer. The floor comes from the CSS Custom Highlight API (used to underline phrases without touching the page's DOM) and the manifest key declaring that the extension collects no data.

Chrome or Chromium 128 or newer. The floor comes from `document.caretPositionFromPoint`, which touch and underline hit-testing stand on.

### Firefox on Android

The same package works on Android, same version floor. The popup opens from the ⋮ menu, under **Extensions**.

On a phone the extension starts in **reader-only mode**: ordinary pages are left alone, and selecting text offers one action — opening the page in the reader, where translation, saving and underlining work as usual. The reason: the translation bubble and Android's own copy menu compete for the same spot on screen. The mode is a regular setting (**Only in the reader**) and can be switched off for the full desktop behaviour.

## Development

```bash
npm install          # once
npm run build        # dist/firefox
npm run build:chromium   # dist/chromium
npm start            # build, then launch Firefox with the extension loaded
tools/check.sh       # quality gate: vendor checksums, typecheck, tests, both builds, addons-linter
npm run sign         # gate, then AMO signing (needs credentials, see below)

node tools/models-registry.mjs --all   # rewrite the model registry (network; downloads gigabytes, --pairs=en-pl,pl-en narrows it)
node tools/wikdict-catalog.mjs         # rewrite the dictionary catalogue (network)
```

`tools/check.sh` is exactly what CI runs. The two registry tools are run by hand when upstream releases change, and their output is committed.

### Installing a build that survives a restart

Firefox permanently installs only signed packages; anything loaded through `about:debugging` or `web-ext run` disappears on restart, together with the vocabulary database. `npm run sign` runs the gate, uploads `dist/firefox` to AMO for validation and signing, and saves the signed `.xpi` to `web-ext-artifacts/`. The channel is **unlisted**: nothing appears in the add-on directory and nobody else can find or install the result.

Installing:

- **Desktop:** **about:addons** → cog → **Install Add-on From File**, or drag the `.xpi` onto a Firefox window.
- **Android:** copy the `.xpi` to the phone, unlock the hidden menu (tap the Firefox logo five times in **Settings → About Firefox**), then pick **Install extension from file**.

Installing a newer build over an older one keeps the vocabulary — the extension id, and with it the database, stays the same.

### Loading in Chrome / Chromium

Chrome loads the build directly, no signing involved: **chrome://extensions** → enable **Developer mode** → **Load unpacked** → pick `dist/chromium`. The load survives restarts, but Chrome shows a "developer mode extensions" notice on startup; publishing outside developer mode would be a Web Store matter, which this project has not taken up.

Run `npm run build:chromium` immediately before loading or reloading. `dist/` is a build product: the quality gate deletes and rebuilds it on every run, so a reload that races a build - or trails an interrupted one - loads a package with files missing, and the errors (`ERR_FILE_NOT_FOUND` in the console of extension pages) point at the load, not at the code. When in doubt: build, then press reload on **chrome://extensions**.

One directive of the pages' Content-Security-Policy is looser in the Chromium package: `style-src` allows inline styles (`'unsafe-inline'`, patched in by `tools/manifest-target.mjs`). The reader parses other people's pages with `DOMParser`; the parsed document inherits the policy, and Chromium files a violation report for every inline style it meets there - styles that never take effect, since that document is never rendered and the article builder strips `style` attributes before anything reaches a live page. An unpacked extension collects those reports into a red "Errors" button on the extensions page, which reads as a malfunction where nothing is wrong. Scripts stay locked in both packages, and the Firefox package keeps the strict directive - Firefox files no such reports.

Signing needs an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/):

```bash
cp .env.example .env   # gitignored; fill in WEB_EXT_API_KEY and WEB_EXT_API_SECRET
```

AMO refuses any version number it has already seen, so each signed build raises `version` in both `src/manifest.json` and `package.json` (scheme: `0.<milestone>.<build>`).

### Code

Plain JavaScript with JSDoc types, checked by TypeScript in `--noEmit` mode. esbuild bundles it (content scripts cannot be ES modules); the output is deliberately not minified.

```
src/
  background/    the only context that translates and owns the database
  content/       what runs on every page: selection, bubble, highlighting
  reader/        the extension's own reader mode
  options/       settings
  offscreen/     Chromium only: the page hosting the engine's worker
  lib/
    translator/  engine facade and its providers
    models/      translation models: registry, download, verification, storage
    matcher/     tokenisation and phrase matching
    dict/        StarDict dictionaries
    store/       IndexedDB, import and export
vendor/
  bergamot/      the engine, committed rather than installed
```

## Licence

[AGPL-3.0-or-later](LICENSE), the same as the KOReader plugin it exchanges files with.

## Support

re/read is built by a non-profit foundation — no investors, no ads, no tracking. If you find it useful and want to support its continued development, every donation helps us build software free from commercial pressure.

→ [**Donate via Wise**](https://wise.com/pay/business/fundacjareborn?description=Donation+-+statutory+purposes)

→ [**More ways to support**](https://reapps.eu/#support)

---

Built with privacy in mind by [Fundacja Reborn](https://reborn.org.pl) (Poland).
