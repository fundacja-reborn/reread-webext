/**
 * The reader page. A placeholder until the reader milestone: Readability turns
 * the page into an article, this page renders it, and the highlighter finally
 * gets a document it fully controls.
 */

import { webext } from "../lib/browser.js";

const version = document.getElementById("version");
if (version !== null) version.textContent = webext().runtime.getManifest().version;
