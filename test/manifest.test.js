import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Everything here guards a door that only opens one way. Once AMO has signed a
 * package, the version number is spent for good and the extension id is bound
 * to an account - and to a database, because Firefox keys extension storage by
 * id. A mistake in either is not a bug to fix in the next commit; it is a second
 * add-on and somebody's vocabulary left behind in the first one.
 *
 * @param {string} path
 */
async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

describe("the manifest that gets signed", () => {
  it("agrees with package.json about the version", async () => {
    const manifest = await json("../src/manifest.json");
    const pkg = await json("../package.json");
    assert.equal(
      manifest.version,
      pkg.version,
      "two files claim different versions - one of them would end up on a signed package nobody can identify",
    );
  });

  it("numbers the version as 0.<milestone>.<build>", async () => {
    const { version } = await json("../src/manifest.json");
    // AMO refuses any upload that does not rise above the last one, so the shape
    // matters more than it looks: the middle number says which milestone the
    // build carries, the last one counts signed builds within it.
    assert.match(version, /^\d+\.\d+\.\d+$/, `"${version}" is not <major>.<minor>.<patch>`);
  });

  it("keeps the extension id the first signature bound", async () => {
    const { browser_specific_settings } = await json("../src/manifest.json");
    assert.equal(browser_specific_settings.gecko.id, "@reread-webext-reapps-eu");
    // Firefox accepts two shapes and this is the second one, with the local part
    // left empty on purpose: an id is a namespace, not a mailbox, and a real
    // address in a package anybody can read is an address that collects spam.
    assert.match(browser_specific_settings.gecko.id, /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/);
  });

  it("still declares that the extension collects nothing", async () => {
    const { browser_specific_settings } = await json("../src/manifest.json");
    // AMO requires this key from every new submission, and "none" is the whole
    // claim the project makes. Dropping it would fail validation; changing it
    // would be a different project.
    assert.deepEqual(browser_specific_settings.gecko.data_collection_permissions, {
      required: ["none"],
    });
  });
});
