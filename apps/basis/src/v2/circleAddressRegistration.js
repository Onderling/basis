/**
 * basis v2 — registering per-circle addresses on a relay, SCOPED (G13 step B's missing production half).
 *
 * Step B built the mechanism — `Transport.addAddress` + replay-on-reconnect — and only tests ever called
 * it. This is the caller, and its shape is dictated by Frits' relay-diversity rule (2026-07-28,
 * `docs/decisions.md`):
 *
 *   **A per-circle address is registered ONLY on relays that circle rides.**
 *
 * The G13 concession — "the relay you chose can correlate your circles" — is PER RELAY. Someone whose
 * circles ride different relays is unlinkable to every one of them, because no single relay sees two of
 * their addresses. Register everything everywhere and that property is silently gone: each relay is handed
 * a linkage it could never observe on its own. So the scoping here is not an optimisation; it is the
 * difference between a per-relay concession and a global one.
 *
 * The scoping source is the connection-points store (`circlesFor(url)`), which the invites already
 * populate. A circle with no recorded point rides the deployment default and registers there alone.
 */

import { POINT_KIND } from './connectionPoints.js';

/**
 * Register this device's per-circle addresses on ONE relay socket, scoped to the circles that ride it.
 *
 * Safe to call repeatedly (addAddress is idempotent; replay covers reconnects) and safe before the flip:
 * registering is harmless while senders still resolve the old way — that is the A/B-parallel design.
 *
 * @param {object} a
 * @param {object} a.transport            the relay transport (must support aliases)
 * @param {string} a.relayUrl             which relay this socket is connected to
 * @param {string[]} a.circleIds          ALL my circles — scoping happens here, not at the caller
 * @param {(circleId: string) => string|null|Promise<string|null>} a.circleAddressFor
 *   the proven per-circle address (derived at join, on the roster)
 * @param {(url: string) => string[]} [a.circlesForPoint]   the connection-points mapping; absent ⇒ no
 *   store, every circle is treated as riding the default
 * @param {string|null} [a.defaultRelayUrl]  the deployment default relay
 * @param {(err: Error, circleId: string) => void} [a.onError]
 * @returns {Promise<{registered: string[], skippedOffRelay: string[], noAddress: string[], failed: string[]}>}
 */
export async function registerCircleAddresses({
  transport,
  relayUrl,
  circleIds = [],
  circleAddressFor,
  circleAddressSignerFor = null,
  circlesForPoint = null,
  defaultRelayUrl = null,
  onError = null,
} = {}) {
  const out = { registered: [], skippedOffRelay: [], noAddress: [], failed: [] };
  if (!transport?.supportsAliases || typeof transport.addAddress !== 'function') return out;
  if (typeof circleAddressFor !== 'function' || !relayUrl) return out;

  // Which circles ride THIS relay. With a points store: exactly its mapping, plus unmapped circles when
  // this is the default. Without one: everything rides the default (the single-relay world).
  const mapped = typeof circlesForPoint === 'function' ? circlesForPoint(relayUrl) ?? [] : null;
  const isDefault = defaultRelayUrl != null && relayUrl === defaultRelayUrl;

  for (const circleId of circleIds) {
    if (!circleId) continue;

    let ridesHere;
    if (mapped === null) {
      ridesHere = isDefault || defaultRelayUrl == null;   // no store at all ⇒ single-relay world
    } else if (mapped.includes(circleId)) {
      ridesHere = true;
    } else {
      // Not mapped to this relay. An UNMAPPED circle (no point recorded anywhere for it) falls to the
      // default; a circle mapped to a DIFFERENT relay must never register here — that is the leak.
      const mappedSomewhere = typeof circlesForPoint === 'function'
        && circleMappedAnywhere(circlesForPoint, circleId, relayUrl);
      ridesHere = !mappedSomewhere && isDefault;
    }
    if (!ridesHere) { out.skippedOffRelay.push(circleId); continue; }

    let address = null;
    try { address = await circleAddressFor(circleId); } catch { address = null; }
    if (!address) { out.noAddress.push(circleId); continue; }

    // No signer ⇒ the relay's challenge cannot be answered and the registration is refused there. Say
    // so HERE, where the circle id is known: the symptom otherwise is "messages to this circle time out",
    // several layers away from the cause.
    const sign = circleAddressSignerFor?.(circleId) ?? null;
    if (!sign) {
      console.warn(`[circle-address] no signer for ${circleId} — per-circle addressing is OFF for it; `
        + 'messages addressed to this circle will not arrive. Pass circleAddressSignerFor.');
    }

    try {
      const r = await transport.addAddress(address, { sign });
      (r?.ok ? out.registered : out.failed).push(circleId);
      if (!r?.ok) report(onError, new Error(r?.reason ?? 'bind-failed'), circleId);
    } catch (err) {
      out.failed.push(circleId);
      report(onError, err, circleId);
    }
  }
  return out;
}

/**
 * Unregister the addresses of circles that no longer ride this relay — the other half of J-R4: a relay you
 * moved a circle away from stops receiving its registrations, and learns nothing about where it went.
 */
export async function unregisterCircleAddresses({ transport, circleIds = [], circleAddressFor } = {}) {
  const removed = [];
  if (typeof transport?.removeAddress !== 'function' || typeof circleAddressFor !== 'function') return { removed };
  for (const circleId of circleIds) {
    let address = null;
    try { address = await circleAddressFor(circleId); } catch { address = null; }
    if (!address) continue;
    try { transport.removeAddress(address); removed.push(circleId); } catch { /* best-effort */ }
  }
  return { removed };
}

/** Is this circle mapped to any OTHER RELAY? (A helper the scoping rule reads; never throws.) */
function circleMappedAnywhere(circlesForPoint, circleId, exceptUrl) {
  // The points store answers per-url; without a reverse index we ask the store's OWN reverse view when it
  // has one. `circlesForPoint.pointsFor` is duck-typed: hosts pass `(url) => store.circlesFor(url)` plus,
  // optionally, `.pointsFor = (cid) => store.pointsFor(cid)` on the same function.
  const pointsFor = circlesForPoint?.pointsFor;
  if (typeof pointsFor !== 'function') return false;   // no reverse view ⇒ treat as unmapped (register on default)
  try {
    return (pointsFor(circleId) ?? [])
      // RELAY points only (2026-07-30). The question this answers is "does this circle live on a
      // different relay", and a pod is not a relay — it carries no socket and no address registration.
      // Counting one made a pod-backed circle look mapped elsewhere, so its per-circle address registered
      // NOWHERE: it was skipped here as off-relay, and the pod cannot take a registration either. Found
      // walking S4's pod set, where J-NP1 succeeding is precisely what triggered it — recording the pod
      // point is what made the circle look mapped away.
      //
      // A bare-string entry has no kind and is treated as a relay, which is the pre-existing behaviour
      // for hosts that pass a simpler reverse view.
      .filter((p) => (typeof p === 'string' ? true : p?.kind !== POINT_KIND.POD))
      .some((p) => (p?.url ?? p) !== exceptUrl);
  } catch { return false; }
}

function report(onError, err, circleId) {
  try { onError?.(err, circleId); } catch { /* diagnostics only */ }
}
