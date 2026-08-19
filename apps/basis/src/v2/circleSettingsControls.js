/**
 * basis v2 — the settings-surface CONTROLS fold (DESIGN-connectivity-phase4 §9).
 *
 * §9 adds circle/admin transport + route + policy controls to the EXISTING `settings`
 * op as MANIFEST controls (invariant #4 — declared in `apps/basis/manifest.js`, never a
 * per-shell switch). The control DESCRIPTORS live in the manifest; THIS module is the ONE
 * new mechanism they need: `enabledWhen`, a predicate that FOLDS over a circle's route +
 * data-policy to grey out incompatible options — the route × capability matrix from §7:
 *
 *   route                          | member↔member private chat (noticeboard/DM)
 *   -------------------------------|------------------------------------------
 *   pod-only, no relay             | ✗ — pseudonymous pod mediation gives no peer pairwise key
 *   relay / rendezvous available   | ✓ — the direct channel enables the key exchange
 *
 * and: a transport-mode OPTION greys out when its transport isn't available (relay|both
 * need a relay endpoint). The fold REUSES C9's `resolveCircleDataPolicy` for the pod half
 * (no recomputed policy) + the device transport state for the relay half.
 *
 * Constraint honoured: when the route/transport data a control needs isn't actually
 * available yet, the control DEFAULTS TO ENABLED and a seam is logged — a disable is never
 * faked from missing data.
 *
 * Pure JS — no I/O, no clock, no DOM. Deterministic for tests. web ≡ mobile: both shells
 * import THIS resolver + the SAME manifest controls (invariants #1/#2).
 */

import { resolveCircleDataPolicy } from './circleDataPolicy.js';

/** The device transport modes a `transport-mode` control offers (mirrors settingsState.TRANSPORT_MODES). */
export const TRANSPORT_MODES = Object.freeze(['nkn', 'relay', 'both']);

/**
 * Fold the circle policy + device transport state into the ROUTE descriptor the predicates
 * read. `policy` supplies the pod/data-policy half (via C9); `transport` supplies the relay
 * half. A missing `transport` marks the route as `transportKnown:false` so predicates seam to
 * ENABLED instead of faking a disable.
 *
 * @param {object} args
 * @param {object|string|null} [args.policy]      circle policy (or bare data-policy value)
 * @param {{mode?:string, relayUrl?:string, relayConnected?:boolean}|null} [args.transport]  device transport state
 * @returns {{dataPolicy:string, hasPod:boolean, mode:(string|null), relayConfigured:boolean, relayAvailable:boolean, transportKnown:boolean}}
 */
export function resolveCircleRoute({ policy, transport } = {}) {
  const data = resolveCircleDataPolicy(policy);   // C9 — {policy, hasPod, dataMove, ...}; reused, not recomputed.
  const t = transport && typeof transport === 'object' ? transport : null;
  const mode = t && TRANSPORT_MODES.includes(t.mode) ? t.mode : null;
  const relayConfigured = !!(t && (t.relayConnected === true
    || (typeof t.relayUrl === 'string' && t.relayUrl.trim() !== '')));
  // A relay/rendezvous route is available iff a relay endpoint is configured OR the chosen
  // transport-mode routes over the relay. NKN-only + pod mediation ⇒ no pairwise key ⇒ pod-only.
  const relayAvailable = relayConfigured || mode === 'relay' || mode === 'both';
  return {
    dataPolicy: data.policy,
    hasPod:     data.hasPod,
    mode,
    relayConfigured,
    relayAvailable,
    transportKnown: t != null,
    // Whether THIS platform can receive an OS push wake at all (mobile: yes; web: an open tab
    // already receives live, there is no killed-app state to wake). Tri-state: true / false /
    // undefined (shell didn't say — predicates seam to ENABLED, never a faked disable).
    canWakePush: t && typeof t.canWakePush === 'boolean' ? t.canWakePush : undefined,
  };
}

/**
 * The `enabledWhen` predicate registry. A control's `enabledWhen` tag (declared in the
 * manifest) selects one; each folds the ROUTE → `{ enabled, reason }`.
 */
export const ENABLED_WHEN = Object.freeze({
  // Ungated — always interactive (transport-mode + relay endpoint are always editable; only
  // their per-option availability is folded, see optionEnabledWhen).
  always: () => ({ enabled: true, reason: 'always' }),

  // Route × capability (§7): member↔member private chat needs a peer pairwise key, which only
  // a relay/rendezvous route provides. relay available → enabled; pod-only (no relay) → disabled.
  // No transport data at all → ENABLED + a `route-unknown-default-enabled` seam (never a faked disable).
  relayRoute: (route) => {
    if (route.relayAvailable) return { enabled: true, reason: 'relay-route' };
    if (!route.transportKnown) return { enabled: true, reason: 'route-unknown-default-enabled' };
    return { enabled: false, reason: 'pod-only-no-relay' };
  },

  // Platform push capability (the wake-nudges toggle): only a platform with an OS push path can
  // be woken while the app is asleep. The shell states it (`transport.canWakePush`); explicitly
  // false → disabled with the honest why; unsaid → ENABLED + seam (never a faked disable).
  pushCapable: (route) => {
    if (route.canWakePush === true) return { enabled: true, reason: 'push-capable' };
    if (route.canWakePush === false) return { enabled: false, reason: 'no-push-on-platform' };
    return { enabled: true, reason: 'route-unknown-default-enabled' };
  },
});

/**
 * Per-OPTION availability for a `transport-mode` control (optionEnabledWhen:'transportAvailable'):
 * NKN is the default transport (always available); relay|both need a configured relay endpoint.
 * Relay availability unknown (no transport data) → ENABLED + seam.
 *
 * @param {string} mode  one of TRANSPORT_MODES
 * @param {ReturnType<typeof resolveCircleRoute>} route
 * @returns {{enabled:boolean, reason:string}}
 */
export function transportOptionEnabled(mode, route) {
  if (mode === 'nkn') return { enabled: true, reason: 'default-transport' };
  if (route.relayConfigured) return { enabled: true, reason: 'relay-configured' };
  if (!route.transportKnown) return { enabled: true, reason: 'route-unknown-default-enabled' };
  return { enabled: false, reason: 'relay-not-configured' };
}

/**
 * THE fold both shells call: resolve every control's enable-state (and, for a choice control
 * with `optionEnabledWhen`, its per-option state) against the circle's route + policy.
 *
 * @param {Array<object>} controls  the manifest `settings` op controls
 * @param {object} [ctx]
 * @param {object|string|null} [ctx.policy]     circle policy
 * @param {object|null} [ctx.transport]         device transport state
 * @param {(msg:string) => void} [ctx.log]      seam logger (defaults to console.info)
 * @returns {Record<string, {enabled:boolean, reason:string, route:object, options?:Record<string,{enabled:boolean,reason:string}>}>}
 */
export function resolveControlEnablement(controls, ctx = {}) {
  const route = resolveCircleRoute(ctx);
  const log = typeof ctx.log === 'function'
    ? ctx.log
    : (typeof console !== 'undefined' ? (m) => console.info(m) : () => {});
  const out = {};
  for (const c of (Array.isArray(controls) ? controls : [])) {
    if (!c || !c.id) continue;
    const pred = ENABLED_WHEN[c.enabledWhen] || ENABLED_WHEN.always;
    const res = pred(route);
    if (res.reason === 'route-unknown-default-enabled') {
      log(`[settings-controls] ${c.id}: route/transport data unavailable — defaulting ENABLED (seam)`);
    }
    const entry = { enabled: res.enabled !== false, reason: res.reason, route };
    if (c.optionEnabledWhen === 'transportAvailable' && Array.isArray(c.of)) {
      entry.options = {};
      for (const m of c.of) {
        const or = transportOptionEnabled(m, route);
        if (or.reason === 'route-unknown-default-enabled') {
          log(`[settings-controls] ${c.id}:${m}: relay availability unknown — defaulting ENABLED (seam)`);
        }
        entry.options[m] = { enabled: or.enabled !== false, reason: or.reason };
      }
    }
    out[c.id] = entry;
  }
  return out;
}

/** Read the `settings` op's declared controls from a (basis) manifest — the single source of truth (invariant #4). */
export function settingsControlsFromManifest(manifest) {
  const op = manifest && Array.isArray(manifest.operations)
    ? manifest.operations.find((o) => o && o.id === 'settings')
    : null;
  return Array.isArray(op && op.controls) ? op.controls : [];
}
