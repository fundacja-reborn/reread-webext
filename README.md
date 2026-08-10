# re/read

A browser extension for reading in a language you are still learning. Select a word or a
phrase, see what it means, keep it. Every phrase you keep is underlined on every page you
open afterwards, and one click marks it learned and makes the underline go away.

All of it happens on your device. The translation engine runs locally, the vocabulary
lives in the browser's own storage, and nothing you read or select is ever sent anywhere.

Sister project of [offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin),
which does the same thing for KOReader. The two exchange vocabulary through the same TSV
file, so what you collect on an e-reader underlines itself in your browser and back.

## Status

**Early. This is a skeleton, not a tool yet.** What is in the repository today:

| Part | State |
|---|---|
| Extension loads in Firefox, bubble appears next to a selection | yes |
| Translation | no engine bundled yet - the bubble says so |
| Vocabulary database, highlighting saved phrases | not started |
| Reader mode | not started |
| Import / export (TSV), settings page | not started |
| Chromium | builds, untested |

If you are looking for something to use rather than something to read, come back later.

## What it deliberately does not do

- **No accounts, no sync, no telemetry, no analytics.** There is no server to have an
  account on.
- **No spaced repetition, no flashcards, no quizzes.** Export to TSV and use Anki, which
  is better at it than anything that could be added here.
- **No inflection handling.** Matching is literal: saving `read` does not underline
  `reading`. A known limit, accepted on purpose.
- **No remote code.** Everything that runs is in the package you installed, which
  Manifest V3 enforces anyway.

## Privacy, and how to check it

The only network request this extension will ever make is downloading a translation model
for a language pair, once, when you ask for it. There is nothing else to send and nowhere
to send it: the page text, your selections and your vocabulary never leave the device.

That claim is checkable rather than promised - open the network panel in devtools and
read along, or read the source, which is deliberately shipped unminified.

### Permissions, and why each one is needed

| Permission | Why |
|---|---|
| `storage` | The vocabulary and the settings. Browser-local, per extension, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes; the default quota is not enough to keep one. |
| `<all_urls>` | The whole point is that saved phrases are underlined on **every** page, not on a list of sites you approved one by one. This is a broad permission and it is honest to say so: it means the extension can read the pages you visit. It reads them to find your saved phrases in the text, in a content script on your machine, and sends nothing. |

There is nothing else. No `tabs`, no `webRequest`, no `cookies`, no `downloads`.

## Requirements

Firefox 142 or newer. Two things set that floor: the CSS Custom Highlight API, which is
how phrases get underlined without touching the page's DOM, and the manifest key this
extension uses to declare that it collects no data at all.

## Development

```bash
npm install          # once
npm run build        # dist/firefox
npm start            # build, then launch Firefox with the extension loaded
tools/check.sh       # the quality gate: typecheck, tests, build, addons-linter
```

`tools/check.sh` is exactly what CI runs. There is no step in one that is missing from
the other.

The extension is plain JavaScript with JSDoc types, checked by TypeScript in `--noEmit`
mode. esbuild bundles it - not to make it smaller, but because content scripts cannot be
ES modules - and the output is deliberately not minified.

```
src/
  background/    the only context that translates and owns the database
  content/       what runs on every page: selection, bubble, highlighting
  reader/        the extension's own reader mode
  options/       settings
  lib/
    translator/  engine facade and its providers
    matcher/     tokenisation and phrase matching
    store/       IndexedDB, import and export
```

## Licence

[AGPL-3.0-or-later](LICENSE), the same as the KOReader plugin it exchanges files with.

Made by [Fundacja Reborn](https://github.com/fundacja-reborn).
