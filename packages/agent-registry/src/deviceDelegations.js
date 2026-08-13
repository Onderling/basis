// deviceDelegations.js — the enrolled-devices map carried in the profile property graph.
//
// The bookkeeping half of add-a-device: at the enrollment ceremony a device's delegation record
// (root-signed statement binding profileId + deviceId + the device's delegation pubKey — see
// core's deviceDelegation.js) is written under ONE property key as a `{ [deviceId]: record }`
// map. Same construction as circleMembership.js: it rides the own/inherit property graph and
// round-trips through export/restore for free (the registry persists `properties` verbatim), so
// no schema change or version bump.
//
// What this is NOT: an authority circles depend on. Every device address still proves itself at
// the roster with its own circle-link proof (deny-by-default at the fold). The map exists so a
// ceremony can answer "which devices are enrolled" (auditable enrollment, the honest device list)
// and so revocation has a durable subject: a revoked device's record flips `revoked: true` and
// stays — the tombstone is the evidence the eviction machinery acts on.
//
// Pure — web ≡ mobile, no I/O; the only place that knows the shape a delegation property holds.

import { setOwn } from './profileProperties.js';

/** The canonical property key holding the `{ [deviceId]: record }` map. */
export const DEVICE_DELEGATIONS_KEY = 'deviceDelegations';

/**
 * True iff `v` is a well-formed delegation record: the root-signed statement fields plus local
 * bookkeeping. `label` is the human name the enroll UI collects ("Frits' telefoon"); `revoked`
 * marks a tombstone; `issuedAt` is informational (NOT part of the signed statement).
 * @param {*} v
 */
export function isDeviceDelegationRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const k of ['profileId', 'deviceId', 'pubKey', 'by', 'sig']) {
    if (typeof v[k] !== 'string' || !v[k]) return false;
  }
  if (v.label != null && typeof v.label !== 'string') return false;
  if (v.issuedAt != null && typeof v.issuedAt !== 'string') return false;
  if (v.revoked != null && typeof v.revoked !== 'boolean') return false;
  return true;
}

/** Freeze-normalise a record to exactly the known fields (drops unknown). Invalid → null. */
export function normaliseDeviceDelegation(v) {
  if (!isDeviceDelegationRecord(v)) return null;
  const rec = { profileId: v.profileId, deviceId: v.deviceId, pubKey: v.pubKey, by: v.by, sig: v.sig };
  if (v.label != null) rec.label = v.label;
  if (v.issuedAt != null) rec.issuedAt = v.issuedAt;
  if (v.revoked != null) rec.revoked = v.revoked;
  return Object.freeze(rec);
}

/** Read the OWN `{ [deviceId]: record }` map straight off one registry entry (no inherit chain). */
export function deviceDelegationsOf(entry) {
  const cur = entry?.properties?.[DEVICE_DELEGATIONS_KEY];
  const map = cur?.mode === 'own' ? cur.value : undefined;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

/** One device's record off an entry, or null. */
export function deviceDelegationOf(entry, deviceId) {
  return deviceDelegationsOf(entry)[deviceId] ?? null;
}

/**
 * Upsert one device's delegation record as an OWN property. Returns a NEW frozen properties map
 * (other devices' records preserved). A REPLACE per device, not a facet merge — the record is a
 * signed statement and partial edits would detach the signature from what it covers. The one
 * sanctioned mutation of an existing record is the tombstone: `patch` may be `{revoked: true}`
 * alone, which flips the flag and keeps the signed fields intact.
 * @param {object} properties  the profile's current properties map
 * @param {string} deviceId
 * @param {object} patch       a full record, or `{revoked: true}` for an existing one
 */
export function setDeviceDelegation(properties, deviceId, patch) {
  if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('setDeviceDelegation: deviceId required');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('setDeviceDelegation: record required');
  const cur = properties?.[DEVICE_DELEGATIONS_KEY];
  const curMap = (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value))
    ? cur.value
    : {};
  const existing = curMap[deviceId] ?? null;
  const candidate = (patch.revoked === true && Object.keys(patch).length === 1 && existing)
    ? { ...existing, revoked: true }
    : patch;
  const rec = normaliseDeviceDelegation(candidate);
  if (!rec) throw new TypeError('setDeviceDelegation: invalid delegation record');
  return setOwn(properties, DEVICE_DELEGATIONS_KEY, { ...curMap, [deviceId]: rec });
}
