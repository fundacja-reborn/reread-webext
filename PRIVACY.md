# Privacy policy for re/read

Last updated: 19 August 2026. This document lives in the extension's repository, so
every change to it is a commit anyone can read: [`PRIVACY.md`](https://github.com/fundacja-reborn/reread-webext/blob/main/PRIVACY.md).

## The short version

re/read collects nothing. There is no account, no server, no telemetry, no analytics,
no advertising and no profiling. Nothing you read, select, save or search for leaves
your device.

The extension is not a client of any service. It has no backend to talk to, and the
publisher receives no data from it of any kind - not even a count of installations
beyond what the add-on stores themselves report to us.

## What re/read stores, and where

Everything the extension keeps lives in your browser's own local extension storage
(IndexedDB and `storage.local`) on your device. None of it is synced to any account,
and none of it is readable by the pages you visit.

| What | Why it is stored |
|---|---|
| Saved phrases with their meanings | To underline them on later pages and show your meaning again |
| Translation models you downloaded | So translation works offline |
| Dictionaries you installed | So dictionary lookups work offline |
| Articles and books you saved to the reading list | So they open with no network, and after the original page has changed or gone |
| Highlights, notes and reading positions | To restore a document the way you left it |
| Settings, including the list of sites you switched re/read off on | To keep your choices between sessions |

Uninstalling the extension deletes all of it, because the browser deletes an
extension's storage together with the extension. You can also remove any part of it
from inside the extension itself: individual phrases (**Learned**), individual
articles and books (**Delete**), models and dictionaries (their sections in
Settings), and the per-site off switches (Settings, **Switched-off sites**).

Your data can be exported at any time to files you choose the location of: vocabulary
as TSV, the reading list as JSON (or as a `.zip` with its pictures), highlights as
Markdown. Those files are written by
the browser's own download mechanism to your disk; they are not uploaded anywhere.

## What leaves your device

Exactly two hosts, both written into the package, both reached only after you click a
button on the Settings page:

- **`storage.googleapis.com`** - Mozilla's published storage bucket: the list of
  translation models and the model files themselves.
- **`download.wikdict.com`** - the [WikDict](https://www.wikdict.com/) catalogue: the
  list of available dictionaries and the dictionary files themselves.

These are ordinary file downloads. Like any download, they let the host serving the
file see your IP address and your browser's user agent; re/read adds no identifier,
no cookie and no query of its own, and sends nothing about you, your vocabulary or
the pages you read. Opening the Settings page makes no request at all - the lists
shown there come from a snapshot inside the package until you press **Update list**,
and each list shows the date it was last fetched.

One more request is yours to make, and it is the only one to an address the package
does not carry: **Download pictures**, a row in the reader's menu over a saved article,
fetches that article's pictures from the servers the article itself names - once,
without cookies or referrer, and only when you press it. Those servers see what they
saw when the page first showed you the pictures: your IP address and your browser's
user agent, nothing more. Nothing fetches a picture on its own, and a saved article
stays text until you ask; the same row removes the pictures again.

There is no third host of the extension's own. No fonts, scripts or images are loaded
from a CDN, no crash reporter, no A/B testing, no update ping of the extension's own
(updates are handled by the browser and the add-on store you installed from, under
their policies).

You do not have to take our word for it: watch the network panel in devtools, read
the source (it ships unminified, exactly as it is in the repository), or simply turn
the network off - translation, dictionaries, the reading list and everything else
keep working.

## Reading aloud

Read-aloud uses the browser's own speech synthesis (the standard Web Speech API). The
extension hands the text to the browser and nothing else; it makes no network request
for speech.

One honest caveat, because it is outside the extension's control: which voice speaks
is a browser and operating system setting, and on some systems a system voice is a
cloud voice - the operating system may send the text it is asked to speak to its own
service. That behaviour belongs to your OS and its privacy policy, not to re/read,
and it applies to every application that speaks on that system. If it matters to you,
choose a voice your system marks as offline or on-device in the **Voice** setting.

## Page content

The content script reads the text of pages you visit in order to find your saved
phrases in it and underline them. This happens entirely in your browser's memory, on
your device. The text is not stored, not sent and not indexed; nothing is written
anywhere except when you yourself save a phrase or save the article to the reading
list.

A page you have switched re/read off on (the toolbar popup, or the list in Settings)
is not read at all.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Your vocabulary and settings, in the browser's local extension storage. Never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and dictionaries can be larger; the browser's default quota is not enough for them. |
| `<all_urls>` (access to all websites) | Saved phrases are underlined on every page where they appear, so the content script has to be able to run everywhere. This is a broad permission: it means the extension can read the pages you visit. It reads them locally to find your saved phrases, and sends nothing. There is no narrower version of "wherever you happen to read". |
| `offscreen` (Chrome/Chromium package only) | Chromium runs the extension's background as a service worker, which cannot start the worker the translation engine lives in. The single offscreen document hosts that worker. It grants no access to any page or to any data. |

There is deliberately nothing else: no `tabs`, no `webRequest`, no `cookies`, no
`downloads`, no `history`, no `bookmarks`.

## Data sharing

re/read does not collect user data, so there is nothing to share. No data is sold,
rented, transferred to third parties, used for advertising, used to build profiles,
or used for creditworthiness or lending purposes. No data is used for any purpose
unrelated to the extension's single purpose, which is translating and saving phrases
while you read and keeping a local reading list.

## Children

The extension collects no data from anyone, of any age.

## Changes to this policy

If it changes, the change is a commit in the public repository, with the date at the
top of this file updated. The version of the policy that applies to you is the one
published here.

## Who is behind re/read

re/read is made by **Fundacja Reborn**, a non-profit foundation registered in Poland
(KRS 0000708416, NIP PL7343554397), ul. Lwowska 35/5, 33-300 Nowy Sącz. In the
language of the GDPR the foundation would be the data controller - which in this case
controls nothing, because the extension sends it nothing and it operates no service
the extension talks to.

The foundation's [general privacy policy](https://reapps.eu/privacy/) covers re/notes
and re/task, which do have accounts and a server. re/read has neither, and this
document is its policy.

## Contact

Questions, or something here that does not match what the code does:
[open an issue](https://github.com/fundacja-reborn/reread-webext/issues) or write to
dev@reapps.eu.

re/read is free software under
[AGPL-3.0-or-later](https://github.com/fundacja-reborn/reread-webext/blob/main/LICENSE).
