/**
 * personKey — the PERSON-level signing key: rotating, per profile, rotated only in a ceremony.
 *
 * The design (plans/NOTE-binding-levels.md §10.1, Frits 2026-09-15): the person level signs with a key that ROTATES,
 * never the static profile key that every device — a stolen one included — holds forever. Version n is derived from
 * the root (the phrase) and the profile: `HKDF(profileSeed, salt, "person-key:<n>")`. So a root-custody device
 * re-derives the current version at boot, and an enrolled device — which never holds the root — is handed the current
 * version's seed at its ceremony (the one moment the phrase is typed there) and keeps it in its sealed vault.
 *
 * Version 1 is announced to a circle by the JOIN (or the circle's `create`), device-in-circle signed — the same
 * trust as the join itself (Frits 2026-09-16, option A): a thief who holds the device holds the current key anyway.
 * Every LATER version is announced by a root-revealed `person-key` statement (security/personKeyFold.js), which
 * a device cannot mint. The rotation ceremony is the next step; this module is the key and its two homes.
 */
import nacl from 'tweetnacl';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';

const HKDF_INFO_NS = 'onderling-identity-v1:';
// FIXED domain-separation salt — permanent, never change (would re-key every person key).
const _PERSON_KEY_SALT = new TextEncoder().encode('onderling-person-key-v1');

/** The sealed-vault entry an enrolled device keeps: `{ version, seed }` (seed b64). */
export const PERSON_KEY_VAULT_KEY = 'person-key';

/**
 * The seed of person key version `version` for a profile.
 * @param {Uint8Array} profileSeed  the profile's derivation seed (`root.deriveAgentSeed(profileId)`)
 * @param {number} version  1, 2, …
 * @returns {Uint8Array} 32 bytes
 */
export function derivePersonKeySeed(profileSeed, version) {
  if (!(profileSeed instanceof Uint8Array) || profileSeed.length !== 32) throw new Error('derivePersonKeySeed: profileSeed must be a 32-byte Uint8Array');
  if (!Number.isInteger(version) || version < 1) throw new Error('derivePersonKeySeed: version must be a positive integer');
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}person-key:${version}`);
  return hkdf(sha256, profileSeed, _PERSON_KEY_SALT, info, 32);
}

/** The public key (b64) behind a person-key seed — what a circle learns. */
export function personKeyPubKeyB64(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('personKeyPubKeyB64: seed must be a 32-byte Uint8Array');
  return b64encode(nacl.sign.keyPair.fromSeed(seed).publicKey);
}

/** Sign with a person-key seed (b64 signature). */
export function signWithPersonKey(seed, messageBytes) {
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return b64encode(nacl.sign.detached(messageBytes, kp.secretKey));
}

/** The announcement shape a join or create carries: `{ version, pubKey }`, or null when malformed. */
export function personKeyAnnouncement(pk) {
  if (!pk || !Number.isInteger(pk.version) || pk.version < 1 || typeof pk.pubKey !== 'string' || !pk.pubKey) return null;
  return { version: pk.version, pubKey: pk.pubKey };
}

/** Read the vault entry. Null when absent or malformed (an enrolled device from before person keys). */
export async function loadPersonKey(vault) {
  let raw = null;
  try { raw = await vault?.get?.(PERSON_KEY_VAULT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Number.isInteger(o?.version) || o.version < 1 || typeof o?.seed !== 'string') return null;
    const seed = b64decode(o.seed);
    if (!(seed instanceof Uint8Array) || seed.length !== 32) return null;
    return { version: o.version, seed };
  } catch { return null; }
}

/** Write the vault entry — only ever a HIGHER version than what is there (a ceremony never rolls a key back). */
export async function storePersonKey(vault, { version, seed }) {
  if (!Number.isInteger(version) || version < 1 || !(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('storePersonKey: {version, seed} required');
  const have = await loadPersonKey(vault);
  if (have && have.version >= version) return false;
  await vault.set(PERSON_KEY_VAULT_KEY, JSON.stringify({ version, seed: b64encode(seed) }));
  return true;
}
