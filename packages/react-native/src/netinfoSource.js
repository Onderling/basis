/**
 * React Native — the netinfo network-change source (Nearby step C).
 *
 * The other half of `networkChangeSource.js`. `AppState` catches "you came back to the app on a different
 * network"; this catches the case `AppState` structurally cannot see: **the network changing while the app
 * is in the foreground.** Two people in a café both hopping to a new SSID without ever backgrounding, a
 * phone falling off Wi-Fi onto cellular mid-conversation, a hotspot appearing.
 *
 * ── Why this is a SEPARATE module ────────────────────────────────────────────────────────────────────────
 * It statically imports `@react-native-community/netinfo`, which is a native module. The repo's established
 * pattern for that (see `BleTransport` + `react-native-ble-plx`) is a dedicated file behind its own subpath
 * export, never the package barrel — so a shell that has not installed the dependency simply never resolves
 * it, rather than failing to bundle. Import it explicitly:
 *
 *     import { subscribeToNetInfo }        from '@onderling/react-native/netinfo';
 *     import { subscribeToNetworkChange, combineSources } from '@onderling/react-native';
 *
 *     const subscribe = combineSources([subscribeToNetworkChange, subscribeToNetInfo]);
 *
 * ⚠ **Native module — requires an app rebuild.** Adding this to a shell's `package.json` is not enough; the
 * Android/iOS binary has to be rebuilt or `NetInfo` is undefined at runtime. See
 * `docs/agent-notes-known-gotchas.md`.
 */
import NetInfo from '@react-native-community/netinfo';

/**
 * What counts as "the network may have changed".
 *
 * NetInfo emits on every state update, including ones that change nothing we care about (a signal-strength
 * tick, a details refresh). Re-announcing on those would be pure noise on top of the burst the watcher is
 * already coalescing, so we compare the fields that actually imply a new network:
 *
 *   • `type`             — wifi → cellular → wifi. A different network by definition.
 *   • `isConnected`      — the drop/restore transition.
 *   • `details.ipAddress`— the one that catches a Wi-Fi→Wi-Fi switch, where `type` never changes.
 *   • `details.ssid`     — same case, when the platform grants it (needs location permission on Android;
 *                          often null, which is why `ipAddress` carries the weight here).
 */
function fingerprint(state) {
  if (!state) return null;
  return [
    state.type ?? '?',
    state.isConnected === true ? '1' : '0',
    state.details?.ipAddress ?? '?',
    state.details?.ssid ?? '?',
  ].join('|');
}

/**
 * Subscribe to netinfo signals that the network may have changed.
 *
 * @param {() => void} onEvent  called on each REAL change — the watcher still coalesces the burst
 * @param {object} [opts]
 * @param {object} [opts.netInfo]  injectable NetInfo, for tests
 * @returns {() => void} unsubscribe
 */
export function subscribeToNetInfo(onEvent, { netInfo = NetInfo } = {}) {
  if (typeof onEvent !== 'function' || typeof netInfo?.addEventListener !== 'function') return () => {};

  // The first emission is the CURRENT state, not a change. NetInfo delivers it immediately on subscribe, so
  // without this the watcher would re-announce once on every startup — exactly what "never fire on
  // subscribe" exists to prevent, arriving one layer lower.
  let last;
  let primed = false;
  let unsubscribe = null;
  try {
    unsubscribe = netInfo.addEventListener((state) => {
      const next = fingerprint(state);
      if (!primed) { primed = true; last = next; return; }
      if (next === last) return;      // an update that changes nothing we route on
      last = next;
      onEvent();
    });
  } catch (err) {
    // The JS module loads on a binary that predates the native one; it throws HERE, at first use
    // ("NativeModule.RNCNetInfo is null"). A missing signal must cost the Wi-Fi-switch re-announce,
    // never the screen (seen as a redbox over Nearby on a phone with an older APK, 2026-08-30).
    if (typeof console !== 'undefined') console.warn('[netinfo] unavailable — no network-change signal:', err?.message ?? err);
    return () => {};
  }

  return () => { try { unsubscribe?.(); } catch { /* best-effort teardown */ } };
}
