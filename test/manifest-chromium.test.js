import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CHROMIUM_ICONS, MINIMUM_CHROME_VERSION, forTarget } from "../tools/manifest-target.mjs";

/**
 * What the build hands Chromium, asserted without running a build. The source
 * manifest is written for Firefox and `forTarget` is the whole difference;
 * a mistake here is not a red CI run but an extension Chrome refuses to load -
 * or loads with a permission nobody signed up for.
 *
 * @returns {Promise<{ source: Record<string, any>, patched: Record<string, any> }>}
 */
async function manifests() {
  const source = JSON.parse(
    await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
  );
  return { source, patched: forTarget(source, "chromium") };
}

describe("the manifest Chromium gets", () => {
  it("leaves the Firefox manifest alone", async () => {
    const { source } = await manifests();
    assert.equal(forTarget(source, "firefox"), source);
  });

  it("does not carry Gecko keys", async () => {
    const { patched } = await manifests();
    assert.equal(patched["browser_specific_settings"], undefined);
    assert.equal(patched["action"]["theme_icons"], undefined);
  });

  it("runs the background as a service worker", async () => {
    const { patched } = await manifests();
    assert.deepEqual(patched["background"], { service_worker: "background/index.js" });
  });

  it("declares the floor the port stands on", async () => {
    const { patched } = await manifests();
    // 128 is `document.caretPositionFromPoint` - the call underline and touch
    // hit-testing stand on; everything else the port needs is older.
    assert.equal(patched["minimum_chrome_version"], MINIMUM_CHROME_VERSION);
  });

  it("adds exactly one permission: offscreen", async () => {
    const { source, patched } = await manifests();
    // The engine host. Anything beyond this one addition is a permission the
    // README's table does not answer for.
    assert.deepEqual(patched["permissions"], [...source["permissions"], "offscreen"]);
    assert.deepEqual(patched["host_permissions"], source["host_permissions"]);
  });

  it("names raster icons everywhere, sized as named", async () => {
    const { patched } = await manifests();
    assert.deepEqual(patched["icons"], CHROMIUM_ICONS);
    assert.deepEqual(patched["action"]["default_icon"], {
      16: CHROMIUM_ICONS[16],
      32: CHROMIUM_ICONS[32],
    });
    for (const path of Object.values(patched["icons"])) {
      assert.match(String(path), /\.png$/, `"${path}" is not a raster Chromium accepts`);
    }
  });

  it("keeps what the port does not touch", async () => {
    const { source, patched } = await manifests();
    for (const key of [
      "manifest_version",
      "name",
      "version",
      "description",
      "default_locale",
      "content_security_policy",
      "content_scripts",
      "commands",
      "options_ui",
    ]) {
      assert.deepEqual(patched[key], source[key], `"${key}" drifted between targets`);
    }
  });

  it("names only files that exist in src", async () => {
    const { patched } = await manifests();
    const named = [
      ...Object.values(patched["icons"]),
      ...Object.values(patched["action"]["default_icon"]),
      // Not in the manifest - created by the background at runtime - but as
      // load-bearing for Chromium as anything the manifest names.
      "offscreen/engine-host.html",
      "offscreen/engine-host.js",
    ];
    for (const path of named) {
      await assert.doesNotReject(
        access(new URL(`../src/${path}`, import.meta.url)),
        `"${path}" is named for Chromium but missing from src/`,
      );
    }
  });
});
