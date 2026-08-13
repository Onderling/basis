// deviceDelegation.js — the per-device derivation root + the root-signed delegation record.
//
// One phrase, many devices, DISTINCT keys. Today two devices holding the same phrase derive the
// IDENTICAL per-circle address (`deriveCircleSeed(profileSeed, circleId)` is deterministic), so a
// second device is a clone of the first, not a device of its own. The delegation seed splits
// that: an enrolled device derives its per-circle keys from its OWN root —
// `deriveDeviceSeed(profileSeed, deviceId)` — so each device presents an honestly distinct
// address per circle (the roster's address SET gains one entry per device), and a stolen device
// yields one revocable device's keys, never the profile's.
//
// The chain: owner root ──deriveAgentSeed(profileId)──▶ profile seed
//            ──deriveDeviceSeed(deviceId)──▶ device seed ──deriveCircleSeed(circleId)──▶ …
// The device seed is profile-seed-SHAPED on purpose: `loadProfile({profileSeed: deviceSeed})`
// and everything downstream (circleAddress / circleSeed / circleIdentity) work unchanged — the
// delegation slots in as the device's derivation root, nothing else re-keys.
//
// The DELEGATION RECORD is the bookkeeping half: a root-signed statement binding
// (profileId, deviceId, delegationPubKey), written to the owner's registry at the enrollment
// ceremony (the phrase is present there — the root never stays resident on the device). Circles
// never DEPEND on the record: every address still proves itself with its own circle-link proof
// at the roster (deny-by-default at the fold). The record exists so enrollment is auditable and
// revocation has a durable subject to act on.
import nacl from 'tweetnacl';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AgentIdentity } from './AgentIdentity.js';
import { encode as b64encode } from '../crypto/b64.js';

// HKDF domain-separation inputs — mirror circleAddress.js. The salt is PERMANENT: changing it
// re-derives every enrolled device's keys (a mass re-enroll), never do that.
const HKDF_INFO_NS = 'onderling-identity-v1:';
const _DEVICE_SEED_SALT = new TextEncoder().encode('onderling-device-seed-v1');

/**
 * Derive a device's 32-byte derivation-root seed from a profile seed. Deterministic — the same
 * phrase + profileId + deviceId reproduce the seed at any ceremony (that is what lets a
 * revocation ceremony reason about an absent device's keys without the device).
 * @param {Uint8Array} profileSeed  the profile's 32-byte seed (= Bootstrap.deriveAgentSeed(profileId)).
 * @param {string} deviceId         the enrolling device's stable id.
 * @returns {Uint8Array} 32-byte seed.
 */
export function deriveDeviceSeed(profileSeed, deviceId) {
  if (!(profileSeed instanceof Uint8Array) || profileSeed.length !== 32) {
    throw new Error('deriveDeviceSeed: profileSeed must be a 32-byte Uint8Array');
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new Error('deriveDeviceSeed: deviceId must be a non-empty string');
  }
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}device:${deviceId}`);
  return hkdf(sha256, profileSeed, _DEVICE_SEED_SALT, info, 32);
}

/** The delegation pubKey a device seed presents (same encoding as every identity pubKey). */
export function deviceDelegationPubKey(deviceSeed) {
  return AgentIdentity.pubKeyFromSeed(deviceSeed);
}

/** The canonical statement the owner root signs. Deterministic; binds profile + device + key. */
export function deviceDelegationMessage(profileId, deviceId, pubKey) {
  return `onderling-device-delegation-v1|${String(profileId)}|${String(deviceId)}|${String(pubKey)}`;
}

/**
 * Mint the root-signed delegation record for a device. Called at the enrollment ceremony, where
 * the phrase (and so the root secret) is transiently present.
 * @param {Uint8Array} rootSecret   the owner root's 32-byte secret (Bootstrap#secret).
 * @param {{profileId: string, deviceId: string, pubKey: string}} a  pubKey = deviceDelegationPubKey(seed).
 * @returns {{profileId:string, deviceId:string, pubKey:string, by:string, sig:string}}
 *          `by` = the root's derived pubKey (b64), `sig` = base64url Ed25519 over the statement.
 */
export function signDeviceDelegation(rootSecret, { profileId, deviceId, pubKey } = {}) {
  if (!(rootSecret instanceof Uint8Array) || rootSecret.length !== 32) {
    throw new Error('signDeviceDelegation: rootSecret must be a 32-byte Uint8Array');
  }
  if (!profileId || !deviceId || !pubKey) {
    throw new Error('signDeviceDelegation: profileId, deviceId and pubKey are required');
  }
  const kp = nacl.sign.keyPair.fromSeed(rootSecret);
  const msg = new TextEncoder().encode(deviceDelegationMessage(profileId, deviceId, pubKey));
  return {
    profileId: String(profileId),
    deviceId:  String(deviceId),
    pubKey:    String(pubKey),
    by:        b64encode(kp.publicKey),
    sig:       b64encode(nacl.sign.detached(msg, kp.secretKey)),
  };
}

/**
 * Verify a delegation record: the signature must cover the statement and verify under `by` —
 * and, when the caller knows the owner's root pubKey, `by` must BE it (a record signed by some
 * other root is not this owner's delegation). Deny-by-default.
 * @param {{profileId:string, deviceId:string, pubKey:string, by:string, sig:string}} record
 * @param {string} [ownerPubKey]  the owner root's pubKey (b64) when known — binds `by` to the owner.
 * @returns {boolean}
 */
export function verifyDeviceDelegation(record, ownerPubKey = null) {
  if (!record || typeof record !== 'object') return false;
  const { profileId, deviceId, pubKey, by, sig } = record;
  for (const v of [profileId, deviceId, pubKey, by, sig]) {
    if (typeof v !== 'string' || v.length === 0) return false;
  }
  if (ownerPubKey != null && by !== ownerPubKey) return false;
  try { return AgentIdentity.verify(deviceDelegationMessage(profileId, deviceId, pubKey), sig, by); }
  catch { return false; }
}
