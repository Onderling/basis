/**
 * basis v2 — installing this device's PER-CIRCLE SIGNING identities (Decision 4).
 *
 * ── What was missing ────────────────────────────────────────────────────────────────────────────
 * A member already presents a different ADDRESS in every circle (`deriveCircleAddress`), so routing
 * no longer names the person. But until now the key that SIGNED a circle envelope — and the key
 * content was sealed to — was the profile's one global identity key, in cleartext in the header
 * (`_to` is rewritten to the recipient's key before signing). Anyone holding two envelopes from two
 * circles could line the person up by key alone, which is precisely the linkage per-circle
 * addressing exists to withhold. `circleIdentity(profileSeed, circleId, vault)` has existed in the
 * kernel the whole time with no callers; this is the caller.
 *
 * ── What installing one does ────────────────────────────────────────────────────────────────────
 * It hands the SecurityLayer an identity of our own plus the address it answers at. From then on:
 *   • an outbound envelope stamped `_from: <that address>` is signed and sealed with that key;
 *   • an inbound envelope sealed to that key is opened with it.
 * BOTH directions need it, which is why this runs for every circle this device is in — at boot, on
 * join, on reconnect — and not lazily on the first send. A device that installed nothing can still
 * receive nothing that was sent to its per-circle address, and that failure is silent at the crypto
 * layer (a box that will not open) unless it is prevented here.
 *
 * ── The one-derivation assumption, and where it lives ───────────────────────────────────────────
 * Nothing in this file assumes the signing key and the address are the same string: it asks for the
 * address and the identity separately and passes both on. The assumption that they coincide lives in
 * ONE place — `circleIdentity` in `packages/core/src/identity/circleAddress.js` — which is open
 * question L2 (`plans/DESIGN-boundary-authentication.md` §13.2), Frits' to answer.
 */

/**
 * Install the signing identity for ONE circle and return the address it speaks from.
 *
 * Idempotent and cheap to call per send: re-registering the same address with the same identity
 * replaces one map entry.
 *
 * @param {object} a
 * @param {string} a.circleId
 * @param {(circleId: string) => string|null|Promise<string|null>} a.circleAddressFor
 * @param {(circleId: string) => object|Promise<object>} a.circleIdentityFor  → an AgentIdentity
 * @param {(address: string, identity: object) => boolean} a.registerSelfIdentity
 * @returns {Promise<string|null>} the per-circle address to send AS, or null when it could not be
 *   installed — the caller then speaks as its canonical identity, which is honest but linkable.
 */
export async function useCircleSigningIdentity({
  circleId, circleAddressFor, circleIdentityFor, registerSelfIdentity,
} = {}) {
  if (typeof circleId !== 'string' || !circleId) return null;
  if (typeof circleAddressFor !== 'function' || typeof circleIdentityFor !== 'function') return null;
  if (typeof registerSelfIdentity !== 'function') return null;
  let address = null;
  try { address = await circleAddressFor(circleId); } catch { address = null; }
  if (typeof address !== 'string' || !address) return null;
  let identity = null;
  try { identity = await circleIdentityFor(circleId); } catch { identity = null; }
  if (!identity || typeof identity.pubKey !== 'string') return null;
  return registerSelfIdentity(address, identity) ? address : null;
}

/**
 * Install the signing identities for every circle this device is in.
 *
 * Best-effort per circle — one circle that cannot derive must never cost the others their identity,
 * because the symptom (nothing arrives in that circle) is indistinguishable from the app being
 * broken. Failures are RETURNED rather than swallowed so a caller can say which circle is affected.
 *
 * @param {object} a
 * @param {string[]} a.circleIds
 * @param {(circleId: string) => string|null|Promise<string|null>} a.circleAddressFor
 * @param {(circleId: string) => object|Promise<object>} a.circleIdentityFor
 * @param {(address: string, identity: object) => boolean} a.registerSelfIdentity
 * @param {(circleId: string) => void} [a.onFailed]
 * @returns {Promise<{installed: string[], failed: string[]}>}
 */
export async function installCircleSigningIdentities({
  circleIds = [], circleAddressFor, circleIdentityFor, registerSelfIdentity, onFailed = null,
} = {}) {
  const out = { installed: [], failed: [] };
  for (const circleId of Array.isArray(circleIds) ? circleIds : []) {
    if (!circleId) continue;
    const address = await useCircleSigningIdentity({
      circleId, circleAddressFor, circleIdentityFor, registerSelfIdentity,
    });
    if (address) out.installed.push(circleId);
    else {
      out.failed.push(circleId);
      try { onFailed?.(circleId); } catch { /* diagnostics only */ }
    }
  }
  return out;
}
