// Identity step 2 — create a root-derived PROFILE entry in the registry.
//
// A profile's signing key is HKDF-derived from the owner root (Bootstrap.deriveAgentSeed),
// so the same owner root + profileId reproduce the SAME pubKey on any device — the recovery
// property. We record only the pubKey (via AgentIdentity.pubKeyFromSeed — no vault); the full
// identity is re-derived on the device that actually runs the profile.
import { AgentIdentity, deriveCircleAddress, mintProfileId, assertProfileId } from '@onderling/core';

/**
 * Create (register) a root-derived PROFILE entry in the registry (identity step 2). The profile's
 * signing key is HKDF-derived from the owner root + `profileId`, so the same inputs reproduce the
 * same pubKey on any device; only the pubKey is recorded — the full identity is re-derived on the
 * device that actually runs the profile.
 *
 * @param {object} a
 * @param {object} a.registry     a createAgentRegistry handle
 * @param {object} a.ownerRoot    a core Bootstrap (deriveAgentSeed + fingerprint)
 * @param {string} [a.profileId]  the persona's stable id (`'default'` or `p-<12 hex>`; also the registry agentId and the
 *                                HKDF label). Absent → one is minted. Never a display name: renaming must not re-key.
 * @param {string} [a.name]       the display name — a property, free to change
 * @param {string} [a.role]       default 'profile'
 * @param {object} [a.properties] own/inherit property map
 * @param {string} [a.agentUri]   default `profile:<id>`
 * @returns {Promise<{ entry: object, pubKey: string, profileId: string }>}
 */
export async function createProfile({ registry, ownerRoot, profileId, role = 'profile', name = null, properties = {}, agentUri } = {}) {
  if (!registry?.register) throw new Error('createProfile: a registry is required');
  if (!ownerRoot?.deriveAgentSeed || !ownerRoot?.fingerprint) {
    throw new Error('createProfile: ownerRoot (a core Bootstrap) is required');
  }
  if (profileId == null || profileId === '') profileId = mintProfileId();
  assertProfileId(profileId);
  const pubKey = AgentIdentity.pubKeyFromSeed(ownerRoot.deriveAgentSeed(profileId));
  const entry = {
    agentId:          profileId,
    pubKey,
    agentUri:         agentUri ?? `profile:${profileId}`,
    role,
    name,
    ownerFingerprint: ownerRoot.fingerprint(),
    properties,
  };
  await registry.register(entry);
  return { entry, pubKey, profileId };
}

/** The deterministic pubKey a profile WOULD have (recovery / verification), without registering. */
export function profilePubKey(ownerRoot, profileId) {
  return AgentIdentity.pubKeyFromSeed(ownerRoot.deriveAgentSeed(profileId));
}

/**
 * The per-circle ADDRESS a profile presents in a circle (step 3 — unlinkable-by-default). Full chain
 * from the owner root: root → profile seed → per-circle address. A distinct key per (profile, circle).
 */
export function profileCircleAddress(ownerRoot, profileId, circleId) {
  return deriveCircleAddress(ownerRoot.deriveAgentSeed(profileId), circleId);
}
