/**
 * basis v2 — wiring the proximity SESSION to the discoverability SURFACE (Nearby step D).
 *
 * `circleProximity.js` owns *when* we should be discoverable (rule (c): only while the Nearby view is
 * open). `@onderling/core`'s discoverability control owns *how* that reaches the transports. This module is
 * the seam between them, and it is deliberately the only place in basis that names a discovery state —
 * opening Nearby is the ONE thing that sets `browse+publish`.
 *
 * Shared, injectable, no transport import: the same module on web and mobile (invariants 1/2). Web has no
 * mDNS or BLE today, so the control it is handed simply has no discovering transports and every call is a
 * truthful no-op — which is better than web having a different code path.
 *
 * ── A constraint found while building this, NOT a decision taken ─────────────────────────────────────────
 * Rule (c) cannot be fully honoured over mDNS until the native split (Nearby step B), and the reason is not
 * laziness:
 *
 *   • `MdnsNative.start()` publishes AND browses in one call, so `browse` degrades to `browse+publish`.
 *   • The obvious fix — rest at `off` — is worse, because **mDNS is also the LAN data channel**. Turning it
 *     off does not just stop advertising; it drops every TCP connection to peers on the network. Closing the
 *     Nearby view would disconnect you from people you are talking to.
 *
 * So on today's transports the resting state is a genuine trade: keep the data channel and stay announced,
 * or go quiet and lose LAN messaging. This module rests at `browse`, keeps the channel, and reports the
 * degradation loudly through `onDegraded` rather than letting a user believe they went quiet. Step B removes
 * the trade entirely. → `plans/PLAN-nearby.md`.
 */
import { DISCOVERABILITY } from '@onderling/core';

/**
 * Adapt a discoverability control into the `startAdvertising` / `stopAdvertising` pair
 * `createProximitySession` expects.
 *
 * The session's hooks are synchronous by contract (it is a lifecycle object, not an async one) while
 * applying a state touches radios. So these fire and report: the state change is kicked off immediately,
 * and its real outcome arrives via `onDegraded` / `onError` and `lastReport()`. A UI that wants to show what
 * the device is ACTUALLY doing reads `lastReport()`, never the session's `isAdvertising()` alone — the
 * session knows what it asked for; only the surface knows what happened.
 *
 * @param {object} deps
 * @param {{set: Function, report: Function}} deps.control  from `createDiscoverabilityControl`
 * @param {string} [deps.restingState='browse']  what to return to when the view closes. See the header for
 *   why this is not `off` today.
 * @param {(report: object) => void} [deps.onDegraded]  the device is more exposed than asked
 * @param {(err: Error, phase: string) => void} [deps.onError]
 * @returns {{startAdvertising, stopAdvertising, lastReport, restingState}}
 */
export function makeNearbySessionAdapter({
  control,
  restingState = DISCOVERABILITY.BROWSE,
  onDegraded = null,
  onError = null,
} = {}) {
  let last = null;

  const apply = (state, phase) => {
    if (!control?.set) return;
    let result;
    try {
      result = control.set(state);
    } catch (err) {
      // A control that throws synchronously is broken, but the session must still open — seeing the room
      // without announcing is a usable state; failing to render it is not.
      try { onError?.(err, phase); } catch { /* diagnostics only */ }
      return;
    }
    Promise.resolve(result)
      .then((report) => {
        last = report;
        if (report?.degraded) { try { onDegraded?.(report); } catch { /* diagnostics only */ } }
      })
      .catch((err) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } });
  };

  return {
    /** Opening Nearby — the ONLY thing in basis that asks to be announced. */
    startAdvertising() { apply(DISCOVERABILITY.PUBLISH, 'start'); },

    /** Closing Nearby — back to the resting state, never left announcing. */
    stopAdvertising() { apply(restingState, 'stop'); },

    /** What the transports last reported — the truthful answer to "am I visible?". */
    lastReport() { return last ? { ...last } : (control?.report?.() ?? null); },

    restingState,
  };
}
