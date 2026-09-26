# Security policy

re/read asks for `<all_urls>` and reads the page you are on, so it holds itself to a short list
of promises: nothing you read, select or save leaves your device ([PRIVACY.md](PRIVACY.md)); the
page you read is not changed beyond underlines and a bubble; and the package in the stores is the
code in this repository - unminified, with the three third-party components vendored byte for
byte and checksummed on every build (`vendor/`, `tools/check-vendor.sh`). A way to break any of
these promises is a security issue, whether or not it takes a hostile page to trigger it.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Report it privately through GitHub:

https://github.com/fundacja-reborn/reread-webext/security/advisories/new

What helps: the browser and its version, the re/read version (the options page shows it), the
page or a minimal HTML file that triggers the problem, and what you observed. English or Polish,
whichever is easier.

This is a one-person project with no security team. You will get an acknowledgement, normally
within a week, and a fix in the next release once the report holds up - releases go to the
stores when a fix is ready, not on a schedule. You will be credited in the release notes unless
you would rather not be.

## Supported versions

Only the latest release, as published on [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/reread/),
in the [Chrome Web Store](https://chromewebstore.google.com/detail/cdeoicfidedlcapagmimcmmeeoplfcla)
and on [GitHub Releases](https://github.com/fundacja-reborn/reread-webext/releases). Browsers
update extensions on their own; there are no maintained older lines.

## What counts

- Anything that makes text, selections, vocabulary, notes or the addresses of pages you read
  leave the device, or contacts any server other than the ones [PRIVACY.md](PRIVACY.md) lists -
  and those only on a click, never on their own.
- A page's content running as script inside the extension - its reader, options page, popup or
  background - or reaching the extension's database from a page.
- A change to the page you read beyond the underlines and the bubble: its DOM, its handlers, its
  global scope.
- A permission the extension holds being usable for more than the [permissions table](README.md#permissions)
  says.

Bugs in the browsers themselves, and in the translation models and dictionaries as data, belong
to their own projects; a report is still welcome when re/read handles them in a way that makes
things worse.

## What is watched, and how

The development dependencies (nothing in the shipped package) are covered by Dependabot alerts
and monthly version updates (`.github/dependabot.yml`). The vendored components are not on any
manifest: their versions and checksums are in `vendor/*/README.md` and `vendor/*/CHECKSUMS`, and
a bump is done by hand from the recipe in each README, with the sums compared against two
sources where two exist. The whole package is shipped as readable source, so that anyone can
check the promises above rather than take them on trust.
