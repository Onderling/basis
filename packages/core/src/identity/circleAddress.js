// Identity step 3 — per-circle addresses (the unlinkability key layer).
// See plans/NOTE-identity-profiles-and-portability.md.
//
// A profile presents a DISTINCT key in each circle:  owner root ──deriveAgentSeed(profileId)──▶
// profile seed ──deriveCircleSeed(circleId)──▶ per-circle seed ──▶ per-circle address.
// Same profile seed + circleId → the SAME address on any device (deterministic, recoverable), but
// a DIFFERENT key per circle, so two circles (or any observer, whatever software they run) cannot
// correlate you by pubkey. Unlinkable-BY-DEFAULT; being "the same person" across circles is a
// deliberate linking act (present the profile's own key), never automatic.
//
// This derives from the PROFILE SEED — not the owner root — so a device that holds only a
// delegated profile (never the root) can still compute its per-circle addresses.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AgentIdentity } from './AgentIdentity.js';

// ⚠ FROZEN FOREVER — this is HKDF domain-separation INPUT, not a name (naming decision 2026-07-28):
// it is hashed, never displayed, never on the wire. "Renaming" it would re-derive every per-circle
// address and orphan all existing rosters/registrations. A future derivation scheme starts at
// 'onderling-identity-v2:'; v1 stays spelled exactly like this.
const HKDF_INFO_NS = 'canopy-identity-v1:';
// FIXED domain-separation salt — permanent, never change (would re-key every per-circle address).
const _CIRCLE_ADDR_SALT = new TextEncoder().encode('canopy-circle-addr-v1');

/**
 * Derive a distinct 32-byte per-circle Ed25519 seed from a profile seed.
 * @param {Uint8Array} profileSeed  the profile's 32-byte seed (= Bootstrap.deriveAgentSeed(profileId)).
 * @param {string} circleId
 * @returns {Uint8Array} 32-byte seed.
 */
export function deriveCircleSeed(profileSeed, circleId) {
  if (!(profileSeed instanceof Uint8Array) || profileSeed.length !== 32) {
    throw new Error('deriveCircleSeed: profileSeed must be a 32-byte Uint8Array');
  }
  if (typeof circleId !== 'string' || circleId.length === 0) {
    throw new Error('deriveCircleSeed: circleId must be a non-empty string');
  }
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}circle:${circleId}`);
  return hkdf(sha256, profileSeed, _CIRCLE_ADDR_SALT, info, 32);
}

/**
 * The per-circle ADDRESS (pubKey) a profile presents in a circle — vault-free, deterministic,
 * same encoding as `AgentIdentity.pubKey`.
 * @param {Uint8Array} profileSeed
 * @param {string} circleId
 * @returns {string} base64 pubKey.
 */
export function deriveCircleAddress(profileSeed, circleId) {
  return AgentIdentity.pubKeyFromSeed(deriveCircleSeed(profileSeed, circleId));
}

/**
 * The per-circle SIGNING identity — the AgentIdentity a profile uses INSIDE a circle (step 5B/C).
 * Its `pubKey` is the per-circle address (what the roster records + what peers route to); sign
 * circle messages with it so members/observers see an unrelated identity per circle. Deterministic
 * and re-derivable from the profile seed, so `vault` may be ephemeral (a `VaultMemory`).
 *
 * @param {Uint8Array} profileSeed
 * @param {string} circleId
 * @param {import('./Vault.js').Vault} vault
 * @returns {Promise<AgentIdentity>}
 */
export function circleIdentity(profileSeed, circleId, vault) {
  return AgentIdentity.fromSeed(deriveCircleSeed(profileSeed, circleId), vault);
}
