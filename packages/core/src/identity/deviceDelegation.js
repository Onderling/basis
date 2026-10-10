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
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { assertProfileId } from './profileIds.js';

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

const _WIRE_ID_SALT = new TextEncoder().encode('onderling-device-wire-id-v1');

/**
 * A device's secret for its wire ids: 32 random bytes, minted once per device, kept sealed in the person's own registry
 * entry beside the internal id. It never leaves the person's devices; it only makes the wire id.
 * @returns {Uint8Array}
 */
export function mintDeviceSalt() {
  return nacl.randomBytes(32);
}

/**
 * The id a device shows ON THE WIRE for one persona — in its delegation record, and so in every device statement
 * that carries it. Per persona and keyed by the device's secret salt: two personas on one device show two unrelated
 * ids, and an old record's internal id plus a persona id are not enough to compute either. The internal id still keys
 * the device's seed (`deriveDeviceSeed`), so no address changes.
 * @param {Uint8Array} deviceSalt  the device's 32-byte secret (`mintDeviceSalt`).
 * @param {string} profileId       a persona id.
 * @returns {string} `d-<32 hex>`
 */
export function wireDeviceId(deviceSalt, profileId) {
  if (!(deviceSalt instanceof Uint8Array) || deviceSalt.length !== 32) {
    throw new Error('wireDeviceId: the device salt must be a 32-byte Uint8Array');
  }
  assertProfileId(profileId);
  const out = hkdf(sha256, deviceSalt, _WIRE_ID_SALT, new TextEncoder().encode(`${HKDF_INFO_NS}wire-device-id:${profileId}`), 16);
  let hex = ''; for (const b of out) hex += b.toString(16).padStart(2, '0');
  return `d-${hex}`;
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
 * @param {Uint8Array} authoritySecret  the signing persona's 32-byte authority (`Bootstrap.deriveProfileAuthority`) —
 *                                  never the owner root, whose key must not appear on the wire.
 * @param {{profileId: string, deviceId: string, pubKey: string}} a  pubKey = deviceDelegationPubKey(seed).
 * @returns {{profileId:string, deviceId:string, pubKey:string, by:string, sig:string}}
 *          `by` = the authority's pubKey (b64), `sig` = base64url Ed25519 over the statement.
 */
export function signDeviceDelegation(authoritySecret, { profileId, deviceId, pubKey } = {}) {
  if (!(authoritySecret instanceof Uint8Array) || authoritySecret.length !== 32) {
    throw new Error('signDeviceDelegation: authoritySecret must be a 32-byte Uint8Array');
  }
  if (!profileId || !deviceId || !pubKey) {
    throw new Error('signDeviceDelegation: profileId, deviceId and pubKey are required');
  }
  const kp = nacl.sign.keyPair.fromSeed(authoritySecret);
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
 * The FIRST device's id, derived from the root. A person's first device mints its own delegation at first boot
 * (2026-09-16) instead of deriving from the profile seed; giving it a root-derived id — rather than a random one —
 * keeps the property the profile derivation had: a device that holds the phrase can re-derive the first device's
 * seed without having seen its registry record, and so retire it and absorb what it sealed when it is lost. Only
 * the first device is special; a device enrolled by a ceremony carries a random id in its root-signed record.
 * @param {{ deriveAgentSeed: (label: string) => Uint8Array }} root  the owner root (Bootstrap)
 * @returns {string}
 */
export function firstDeviceIdFor(root) {
  const seed = root.deriveAgentSeed('first-device');
  let hex = ''; for (const b of seed.subarray(0, 16)) hex += b.toString(16).padStart(2, '0');
  return `first-${hex}`;
}

/**
 * The owner-root FINGERPRINT a signing key presents — the same 16-hex-char scheme as
 * `Bootstrap.fingerprint` (first 16 hex chars of SHA-256 over the raw Ed25519 pubkey), computable
 * from a record's `by` field alone. This is what lets a sibling device bind a carried delegation
 * record to "the same owner as me" without the owner's registry: both custodies hold the root's
 * fingerprint (root custody derives it; delegation custody carries it on the marker), and a record
 * whose `by` does not hash to it belongs to some other root. Returns null for undecodable input.
 * @param {string} pubKeyB64  a base64(url) Ed25519 pubkey — e.g. a delegation record's `by`.
 * @returns {string|null} the 16 hex-character fingerprint, or null.
 */
export function ownerRootFingerprint(pubKeyB64) {
  try {
    const key = b64decode(pubKeyB64);
    if (!(key instanceof Uint8Array) || key.length !== 32) return null;
    const digest = sha256(key);
    let hex = '';
    for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0');
    return hex.slice(0, 16);
  } catch { return null; }
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

/** The canonical statement the owner root signs to retire a device. Deterministic; binds profile + device. */
export function deviceRevocationMessage(profileId, deviceId) {
  return `onderling-device-revocation-v1|${String(profileId)}|${String(deviceId)}`;
}

/**
 * Mint the root-signed REVOCATION of a device — the tombstone a party outside the person's own devices can check
 * (a companion the person owns): the registry's `{revoked: true}` mark is the person's own bookkeeping and signs
 * nothing. Minted at the revoke ceremony, where the phrase (and so the root secret) is transiently present.
 * @param {Uint8Array} authoritySecret  the persona's authority (as for `signDeviceDelegation`)
 * @param {{profileId: string, deviceId: string}} a
 * @returns {{profileId:string, deviceId:string, by:string, sig:string}}
 */
export function signDeviceRevocation(authoritySecret, { profileId, deviceId } = {}) {
  if (!(authoritySecret instanceof Uint8Array) || authoritySecret.length !== 32) {
    throw new Error('signDeviceRevocation: authoritySecret must be a 32-byte Uint8Array');
  }
  if (!profileId || !deviceId) throw new Error('signDeviceRevocation: profileId and deviceId are required');
  const kp = nacl.sign.keyPair.fromSeed(authoritySecret);
  const msg = new TextEncoder().encode(deviceRevocationMessage(profileId, deviceId));
  return {
    profileId: String(profileId),
    deviceId:  String(deviceId),
    by:        b64encode(kp.publicKey),
    sig:       b64encode(nacl.sign.detached(msg, kp.secretKey)),
  };
}

/**
 * Verify a revocation: the signature must cover the statement and verify under `by` — and, when the caller knows
 * the owner's root pubKey, `by` must BE it. Deny-by-default.
 * @param {{profileId:string, deviceId:string, by:string, sig:string}} record
 * @param {string} [ownerPubKey]
 * @returns {boolean}
 */
export function verifyDeviceRevocation(record, ownerPubKey = null) {
  if (!record || typeof record !== 'object') return false;
  const { profileId, deviceId, by, sig } = record;
  for (const v of [profileId, deviceId, by, sig]) {
    if (typeof v !== 'string' || v.length === 0) return false;
  }
  if (ownerPubKey != null && by !== ownerPubKey) return false;
  try { return AgentIdentity.verify(deviceRevocationMessage(profileId, deviceId), sig, by); }
  catch { return false; }
}
