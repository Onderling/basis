// Identity step 3 — per-circle addresses (the unlinkability key layer).
//
// A DISTINCT key in each circle, so two circles (or any observer, whatever software they run)
// cannot correlate you by pubkey. Unlinkable-BY-DEFAULT; being "the same person" across circles is
// a deliberate linking act (present the profile's own key), never automatic.
//
// ── READ THE PARAMETER NAME CAREFULLY ────────────────────────────────────────────────────────────
// These take a DERIVATION SEED — "whatever root this device derives from" — NOT necessarily the
// profile's. The distinction is the whole point, and it hid for weeks behind the old parameter
// name, which asserted something false at every call site:
//
//   owner root ──deriveAgentSeed(profileId)──▶ profile seed ─┬──deriveCircleSeed(circleId)──▶ …
//                                                            └──deriveDeviceSeed(deviceId)──▶
//                                                               device seed ──deriveCircleSeed──▶ …
//
// An ENROLLED device passes its own device seed (see deviceDelegation.js), so it presents an
// honestly DISTINCT address per circle and the roster's address SET gains one entry per device. An
// UNENROLLED first device passes the profile's seed, so the two collapse. The live selection is one
// line in the basis agent: `deviceDerivationSeed = custodySeed ?? defaultProfileSeed`.
//
// So: same derivation seed + circleId → the same address, deterministically and recoverably. Two
// devices of one person do NOT agree unless both derive from the same root. Any consumer matching
// an author against a member must therefore read the roster's address SET, never the primary
// field alone.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AgentIdentity } from './AgentIdentity.js';

// HKDF domain-separation input (hashed, never displayed, never on the wire). Renaming it re-derives
// every per-circle address — a clean break, taken pre-launch (CLAUDE.md, 2026-07-28) rather than
// carrying the old spelling forever.
const HKDF_INFO_NS = 'onderling-identity-v1:';
// FIXED domain-separation salt — permanent, never change (would re-key every per-circle address).
const _CIRCLE_ADDR_SALT = new TextEncoder().encode('onderling-circle-addr-v1');

/**
 * Derive a distinct 32-byte per-circle Ed25519 seed from a profile seed.
 * @param {Uint8Array} derivationSeed  this device's 32-byte derivation root: the profile's seed on an
 *   unenrolled device, the device seed (`deriveDeviceSeed`) on an enrolled one.
 * @param {string} circleId
 * @returns {Uint8Array} 32-byte seed.
 */
export function deriveCircleSeed(derivationSeed, circleId) {
  if (!(derivationSeed instanceof Uint8Array) || derivationSeed.length !== 32) {
    throw new Error('deriveCircleSeed: derivationSeed must be a 32-byte Uint8Array');
  }
  if (typeof circleId !== 'string' || circleId.length === 0) {
    throw new Error('deriveCircleSeed: circleId must be a non-empty string');
  }
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}circle:${circleId}`);
  return hkdf(sha256, derivationSeed, _CIRCLE_ADDR_SALT, info, 32);
}

/**
 * The per-circle ADDRESS (pubKey) this device presents in a circle — vault-free, deterministic,
 * same encoding as `AgentIdentity.pubKey`.
 * @param {Uint8Array} derivationSeed  this device's derivation root — see the header.
 * @param {string} circleId
 * @returns {string} base64 pubKey.
 */
export function deriveCircleAddress(derivationSeed, circleId) {
  return AgentIdentity.pubKeyFromSeed(deriveCircleSeed(derivationSeed, circleId));
}

/**
 * The per-circle SIGNING identity — the AgentIdentity this device uses INSIDE a circle.
 * Its `pubKey` is the per-circle address (what the roster records + what peers route to); sign
 * circle messages with it so members/observers see an unrelated identity per circle. Deterministic
 * and re-derivable from the derivation seed, so `vault` may be ephemeral (a `VaultMemory`).
 *
 * @param {Uint8Array} derivationSeed  this device's derivation root — see the header.
 * @param {string} circleId
 * @param {import('./Vault.js').Vault} vault
 * @returns {Promise<AgentIdentity>}
 */
export function circleIdentity(derivationSeed, circleId, vault) {
  return AgentIdentity.fromSeed(deriveCircleSeed(derivationSeed, circleId), vault);
}
