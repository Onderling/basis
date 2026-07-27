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
 * ── Why the resting state is `browse` ───────────────────────────────────────────────────────────────────
 * Before the mDNS native split (Nearby step B), rule (c) could not be honoured here at all:
 *
 *   • `MdnsNative.start()` published AND browsed in one call, so `browse` degraded to `browse+publish`.
 *   • The obvious fix — rest at `off` — was worse, because **mDNS is also the LAN data channel**. Turning it
 *     off did not merely stop advertising; it dropped every TCP connection to peers on the network, so
 *     closing the Nearby view would disconnect you from people you were talking to.
 *
 * The split removed the trade. `stopAdvertising()` unregisters the service record and leaves the listening
 * socket and every open connection up — advertising is how people FIND you, not how they REACH you. So
 * resting at `browse` now means genuinely unlisted, with the channel intact, which is why it is the default.
 *
 * The old behaviour still exists on a device running an **older Android build** whose `MdnsModule` lacks the
 * split. There the transport reports `browse+publish` when asked for `browse` and `onDegraded` fires — the
 * user is told they are still visible rather than left to assume otherwise. → `plans/PLAN-nearby.md`.
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

  const adapter = {
    /** Opening Nearby — the ONLY thing in basis that asks to be announced. */
    startAdvertising() { apply(DISCOVERABILITY.PUBLISH, 'start'); },

    /** Closing Nearby — back to the resting state, never left announcing. */
    stopAdvertising() { apply(restingState, 'stop'); },

    /** What the transports last reported — the truthful answer to "am I visible?". */
    lastReport() { return last ? { ...last } : (control?.report?.() ?? null); },

    restingState,

    /**
     * The network changed — re-announce at whatever state we are already in (Nearby step C).
     *
     * A shell calls this from its network-change event. It deliberately does NOT open the session or raise
     * the state: switching Wi-Fi must never make a device that is resting start announcing itself. If the
     * view is closed we are at the resting state, and re-announcing that is a no-op or a browse restart.
     */
    onNetworkChange() {
      if (!control?.reannounce) return;
      let result;
      try { result = control.reannounce(); }
      catch (err) { try { onError?.(err, 'reannounce'); } catch { /* diagnostics only */ } return; }
      Promise.resolve(result)
        .then((report) => {
          last = report;
          if (report?.degraded) { try { onDegraded?.(report); } catch { /* diagnostics only */ } }
        })
        .catch((err) => { try { onError?.(err, 'reannounce'); } catch { /* diagnostics only */ } });
    },
  };

  return adapter;
}
