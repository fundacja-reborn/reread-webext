/**
 * How long a warm engine stays in memory after it was last asked - in every
 * browser the same (D298).
 *
 * Standing an engine up is the expensive part of a translation: the binary
 * instantiated, thirty megabytes of model read out of the database and
 * copied into it, the first sentence paying for everything set up lazily.
 * Measured outside a browser on a desktop that is 0.3 s against 0.065 s for
 * a translation by an engine already standing; on an e-ink reader both
 * numbers are many times larger, and only the first is long enough to read
 * as a bubble that hung.
 *
 * Chromium kept the engine for five idle minutes from the start: it lives
 * in the offscreen document, which closes itself on that timer
 * (`offscreen/engine-host.js`). Firefox kept it for thirty seconds: there
 * the engine's worker belongs to the background's event page, and the
 * browser puts an event page down after half a minute without activity.
 * Somebody reading a book meets a new word less often than that, so on
 * Firefox nearly every new word loaded the engine again (Michał's report
 * from a Boox Page, 2026-11-15).
 *
 * So the event page is kept awake for the same five minutes after a
 * translation. The way is the one the Chromium background already uses
 * while an answer is owed (`remote.js`): a call to an extension API on a
 * timer - in Firefox a call that reaches the parent process resets the
 * page's idle clock (`ExtensionParent.sys.mjs`, reason `parentapicall`).
 * The timer runs only inside that window: with nothing translated for five
 * minutes it stops, the page goes idle, and the browser takes the engine's
 * memory back exactly as before. A browser that stopped honouring the call
 * would leave what there was until now - an engine loaded again after
 * thirty seconds - and nothing worse.
 */

/**
 * How long an engine nobody asks stays standing. One number for both
 * browsers: the offscreen host closes itself on it, and the event page is
 * kept awake for it.
 */
export const ENGINE_IDLE_MS = 5 * 60_000;

/**
 * How often an extension API is touched to keep a background awake. Both
 * browsers stop an idle one after thirty seconds, so this is comfortably
 * inside that.
 */
export const HEARTBEAT_MS = 20_000;

/**
 * Keeps something awake for a while after each use: `used()` opens or
 * extends the window, and while the window stands `touch` is called on
 * every beat. The beat that finds the window over stops the timer, so an
 * idle keeper costs nothing at all.
 *
 * @param {object} deps
 * @param {() => void} deps.touch what keeps it awake - a cheap extension API call
 * @param {number} [deps.idle] how long the window stands after a use
 * @param {number} [deps.beat] how often `touch` is called inside it
 * @param {() => number} [deps.now]
 * @param {(work: () => void, ms: number) => unknown} [deps.setTimer] a repeating timer
 * @param {(timer: unknown) => void} [deps.clearTimer]
 * @returns {{ used: () => void, awake: () => boolean, stop: () => void }}
 */
export function warmKeeper({
  touch,
  idle = ENGINE_IDLE_MS,
  beat = HEARTBEAT_MS,
  now = () => Date.now(),
  setTimer = (work, ms) => setInterval(work, ms),
  clearTimer = (timer) => clearInterval(/** @type {ReturnType<typeof setInterval>} */ (timer)),
}) {
  /** @type {unknown} */
  let timer = null;
  let until = 0;

  const stop = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  return {
    used() {
      until = now() + idle;
      if (timer !== null) return;
      timer = setTimer(() => {
        if (now() >= until) stop();
        else touch();
      }, beat);
    },
    awake: () => timer !== null,
    stop,
  };
}

/**
 * A provider whose engine stays warm after it answered. Only an answer
 * that came from the engine opens the window: a missing model, or any other
 * failure, loaded nothing worth keeping.
 *
 * @param {import("./index.js").Provider} provider
 * @param {{ used: () => void }} keeper
 * @returns {import("./index.js").Provider}
 */
export function keptWarm(provider, keeper) {
  return {
    id: provider.id,
    async translate(input) {
      const result = await provider.translate(input);
      if (result.ok) keeper.used();
      return result;
    },
  };
}
