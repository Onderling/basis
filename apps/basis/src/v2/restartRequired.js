import { verbKind } from '@onderling/app-manifest';

/**
 * RESTART REQUIRED — after an op whose result says `reloadRequired` (a phrase restore, an enrolment, a persona removed
 * or received here, a custody cutover that introduced addresses), the running process is still the device's FORMER self: its keys, its stores and its lanes were
 * composed at boot. The phone walk (2026-11-27) went on as the old person after a restore and lost what was written
 * after it. So the app STOPS until it starts again: one state, set at the outer waist by the op's own result, that
 * every shell composes (`onRestartRequired`, a seam in scripts/shell-seams.mjs):
 *   • the waist refuses every op that is not a declared read while it stands (`restartRefusal`), so no write lands
 *     under the former self, whichever surface tries (the composer, a tap, a door);
 *   • the phone paints one full screen that cannot be dismissed and takes no input;
 *   • the web reloads itself; the box exits for its supervisor to start it again.
 * Transports stay up: what arrives is held by the stores as before, and read again by the next start.
 *
 * The state lives in the process (the agent), on purpose: a real start composes a new agent and so begins without it,
 * and a screen remounted inside the SAME process (Android recreating the activity) asks the agent and paints it again.
 * A restore's own after-start work is carried by its vault marker (`RESTORE_PENDING_KEY`), not by this state.
 *
 * An op that only changes what the NEXT start runs (a persona paused or resumed) answers `takesEffectNextStart` instead:
 * this process stays the same selves and loses nothing written in it, so nothing stops (pauseTakesEffectNextStart.test).
 */

export const RESTART_REQUIRED_CODE = 'restart-required';

/** Does this waist result ask for a restart? Only the op's own flag counts. */
export function asksRestart(result) {
  return result != null && typeof result === 'object' && result.reloadRequired === true;
}

/**
 * The refusal for one call while a restart is required, or null. A read the manifests declare passes (a screen behind
 * the stop may still paint); everything else, an unknown op included, is refused: nothing says it only reads.
 * @param {{ required: boolean }} state
 * @param {object[]|null} manifests   the manifests the app runs (`allManifests()`), each naming its `app`
 */
export function restartRefusal(state, manifests, appOrigin, opId) {
  if (!state?.required) return null;
  const manifest = (Array.isArray(manifests) ? manifests : []).find((m) => m?.app === appOrigin) ?? null;
  const op = manifest?.operations?.find?.((o) => o?.id === opId) ?? null;
  if (op && verbKind(manifest, op.verb) === 'read') return null;
  return { ok: false, code: RESTART_REQUIRED_CODE, error: RESTART_REQUIRED_CODE, refusal: { code: RESTART_REQUIRED_CODE } };
}

/**
 * The state itself: `required` once set never clears in this process (only a new start clears it). `on(fn)` calls
 * `fn` once when it is set, at once if it already is; returns an unsubscribe.
 */
export function createRestartState() {
  let required = false;
  let cause = null;
  const subs = new Set();
  return {
    get required() { return required; },
    get cause() { return cause; },
    set(op) {
      if (required) return;
      required = true;
      cause = typeof op === 'string' ? op : null;
      for (const fn of [...subs]) { try { fn({ cause }); } catch { /* a bad painter must not keep the others from stopping */ } }
      subs.clear();
    },
    on(fn) {
      if (typeof fn !== 'function') return () => {};
      if (required) { try { fn({ cause }); } catch { /* as above */ } return () => {}; }
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
