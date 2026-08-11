#!/usr/bin/env bash
# The quality gate. This is exactly what CI runs - if you add a step here, add
# it to .github/workflows/ci.yml in the same commit, and the other way round.
# A check that only exists in CI is a check you find out about from a red main.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> vendored engine"
tools/check-vendor.sh

echo "==> typecheck"
npm run --silent typecheck

echo "==> tests"
npm run --silent test

echo "==> build (firefox)"
npm run --silent build

echo "==> web-ext lint (addons-linter, the one AMO runs)"
# Through `tools/lint.mjs` rather than directly: `web-ext lint` exits 0 for
# warnings and notices, and this project's rule is 0/0/0. The one exception -
# two `innerHTML` lines inside vendored Readability - is pinned there with its
# reason, and anything else yellow fails.
node tools/lint.mjs --source-dir dist/firefox

echo "==> all green"
