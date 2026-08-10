#!/usr/bin/env bash
# The vendored engine is the only part of this package nobody reads. That makes
# it the part most worth pinning: these are the bytes we said were here, and
# this is the check that says so on every run of the gate.
set -euo pipefail

cd "$(dirname "$0")/../vendor/bergamot"

shasum -a 256 --check --status CHECKSUMS || {
  echo "check-vendor: vendored engine does not match CHECKSUMS" >&2
  echo "check-vendor: see vendor/bergamot/README.md - updating is a deliberate act" >&2
  shasum -a 256 --check CHECKSUMS >&2 || true
  exit 1
}

# A file of the right length and hash could still be something WebAssembly
# refuses to load - a truncated Git LFS pointer, say, or a checkout that
# mangled line endings. Asking the runtime is cheap and answers that.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const wasm = await readFile("bergamot-translator-worker.wasm");
  if (!WebAssembly.validate(wasm)) {
    console.error("check-vendor: bergamot-translator-worker.wasm is not a valid module");
    process.exit(1);
  }
'

echo "check-vendor: engine matches CHECKSUMS and is a valid WebAssembly module"
