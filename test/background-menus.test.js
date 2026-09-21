import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MENU, installMenus, menuDoor, menuItems } from "../src/background/menus.js";

/**
 * As much of the menus API as `installMenus` talks to, recording the order of
 * what it was told.
 */
function fakeMenus() {
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../src/background/menus.js").MenuItem[]} */
  const created = [];
  return {
    calls,
    created,
    async removeAll() {
      calls.push("removeAll");
    },
    /** @param {import("../src/background/menus.js").MenuItem} item */
    create(item) {
      calls.push(`create:${item.id}`);
      created.push(item);
      return item.id;
    },
  };
}

/**
 * The same API as strict as the browser is. Calls are carried out in the order
 * they were made, and a wipe is answered a turn of the event loop later - so
 * two callers that wipe in the same breath have both wiped before either hears
 * back. `create` refuses an id it already holds, which the browser reports as
 * "Cannot create item with duplicate id", one entry on the extension's card per
 * refused row.
 */
function strictMenus() {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<string>} */
  const rows = new Set();
  const state = { failNextWipe: false };
  return {
    calls,
    errors,
    rows,
    state,
    async removeAll() {
      calls.push("removeAll");
      const failed = state.failNextWipe;
      state.failNextWipe = false;
      if (!failed) rows.clear();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (failed) throw new Error("the menu refused the wipe");
    },
    /** @param {import("../src/background/menus.js").MenuItem} item */
    create(item) {
      calls.push(`create:${item.id}`);
      if (rows.has(item.id)) errors.push(`Cannot create item with duplicate id ${item.id}`);
      else rows.add(item.id);
      return item.id;
    },
  };
}

describe("the right-click rows", () => {
  it("are a parent named after the extension and two doors under it, worded from the catalogue", () => {
    const items = menuItems();
    assert.deepEqual(
      items.map((item) => [item.id, item.parentId ?? null, item.title]),
      [
        [MENU.parent, null, "re/read"],
        [MENU.read, MENU.parent, "Open in reading view"],
        [MENU.library, MENU.parent, "Offline reading list"],
      ],
    );
  });

  it("show over links, pictures and frames too, not only on bare page ground", () => {
    for (const item of menuItems()) {
      for (const context of ["page", "frame", "selection", "link", "image"]) {
        assert.ok(item.contexts.includes(context), `${item.id} should show in the ${context} context`);
      }
    }
  });

  it("offer the page only where there is a page to read; the list everywhere", () => {
    const [parent, read, library] = menuItems();
    assert.deepEqual(read?.documentUrlPatterns, ["http://*/*", "https://*/*", "file://*/*"]);
    assert.equal(library?.documentUrlPatterns, undefined);
    assert.equal(parent?.documentUrlPatterns, undefined);
  });

  it("are made after a wipe, parent first, so an update never trips over its own rows", async () => {
    const menus = fakeMenus();
    await installMenus(menus);
    assert.deepEqual(menus.calls, ["removeAll", `create:${MENU.parent}`, `create:${MENU.read}`, `create:${MENU.library}`]);
  });

  // The first start after the browser itself was updated: Chromium sends every
  // extension onInstalled (reason chrome_update) as it loads and onStartup right
  // after, and both handlers of the background ask for the rows. Two runs of
  // wipe-then-make interleave - both wipes, then both sets of rows - and the
  // second set was three errors on the extension's card in Brave.
  it("are made once when install and browser start ask for them in the same breath", async () => {
    const menus = strictMenus();
    await Promise.all([installMenus(menus), installMenus(menus)]);
    assert.deepEqual(menus.errors, []);
    assert.deepEqual([...menus.rows], [MENU.parent, MENU.read, MENU.library]);
    assert.deepEqual(menus.calls, ["removeAll", `create:${MENU.parent}`, `create:${MENU.read}`, `create:${MENU.library}`]);
  });

  it("are wiped and made again by a call that comes after a run has finished", async () => {
    const menus = strictMenus();
    await installMenus(menus);
    await installMenus(menus);
    assert.deepEqual(menus.errors, []);
    assert.equal(menus.calls.filter((call) => call === "removeAll").length, 2);
    assert.deepEqual([...menus.rows], [MENU.parent, MENU.read, MENU.library]);
  });

  it("can be asked for again after a run that failed", async () => {
    const menus = strictMenus();
    menus.state.failNextWipe = true;
    await assert.rejects(installMenus(menus), /refused the wipe/);
    await installMenus(menus);
    assert.deepEqual(menus.errors, []);
    assert.deepEqual([...menus.rows], [MENU.parent, MENU.read, MENU.library]);
  });

  it("answer a click with a door, and a click on anything else with nothing", () => {
    assert.equal(menuDoor(MENU.read), "reader");
    assert.equal(menuDoor(MENU.library), "library");
    assert.equal(menuDoor(MENU.parent), null);
    assert.equal(menuDoor(42), null);
    assert.equal(menuDoor("somebody-elses-row"), null);
  });
});
