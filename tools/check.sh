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
# web-ext phones home for a version check through a config store it cannot write
# to here, and prints a box about sudo that has nothing to do with the linting.
NO_UPDATE_NOTIFIER=1 npx --no-install web-ext lint --source-dir dist/firefox

echo "==> all green"
