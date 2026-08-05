// circleMembership.js — per-circle RESTORE data carried in the profile property graph.
//
// The registry is "only what cannot be derived" (NOTE-identity-profiles-and-portability.md,
// "The account — registry small, log big"). A full wipe-and-restore on real hardware established the
// gap this closes: the recovery phrase brought back the IDENTITY, but "nothing else came back" — every
// circle was gone, and a restored member could not even OPEN a message they had already received,
// because the registry had never been extended past identity. Three facets it must gain so a NEW DEVICE
// can re-derive circle state after a wipe ("What the registry must gain"):
//   • membership   — { handle, address, proof }: your per-circle handle + address + the proof you belong.
//   • connection   — { relays: [...] }: which relays the circle rides, so a restored device can reconnect.
//   • key material — { key: { ref, posture } }: the WRAPPED key RESOURCE ref — NOT raw group secrets.
//       posture p2 → the group-key resource; p3 → the wrapped recipient blob. Both unwrap with the
//       reader's PRIVATE KEY, which the recovery phrase re-derives, so the registry carries only a
//       POINTER (`{ ref: "<scheme>:<id>" }`, resolver-swappable — "Keys are referenced, not inlined").
//       Raw secrets in a registry would be strictly worse to carry, and the resource form preserves the
//       retained-version history that gives forward secrecy.
//
// All three restore TOGETHER per circle, so they are ONE record per circleId under ONE property key
// (CIRCLE_MEMBERSHIPS_KEY), a `{ [circleId]: record }` map. It rides the own/inherit graph
// (profileProperties.js) and round-trips through export/restore (exportRegistry.js) for FREE — the
// registry entry already persists `properties` verbatim (opaque value), so this needs NO schema change
// or version bump. This is PERSONAL restore data, NOT a peer-disclosed attribute: it deliberately does
// NOT go through the disclosure ladder (no coarsening, never released to a circle) — unlike drivers /
// location / media, which are the disclosed-attribute vocabularies.
//
// Pure — web ≡ mobile, no I/O; like drivers.js / mediaProperty.js, this is the only place that knows
// the shape a circle-membership property value holds.

import { setOwn, resolveProperty } from './profileProperties.js';

/** The canonical property key holding the `{ [circleId]: record }` map. */
export const CIRCLE_MEMBERSHIPS_KEY = 'circleMemberships';

/** The four sealing postures resolveCircleStorage recognises (only p2/p3 carry key material). */
const POSTURES = Object.freeze(['p0', 'p1', 'p2', 'p3']);

/**
 * True iff `v` is a well-formed wrapped-key-resource POINTER: `{ ref: "<scheme>:<id>", posture? }`.
 * The ref is a reference, never inline secret bytes; posture (optional) is one of p0–p3.
 * @param {*} v
 */
export function isKeyRef(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.ref !== 'string' || !v.ref.includes(':')) return false;     // "<scheme>:<id>"
  if (v.posture != null && !POSTURES.includes(v.posture)) return false;
  return true;
}

/**
 * True iff `v` is a well-formed per-circle membership record. `handle` + `address` are required (who
 * you are in the circle + where you are reachable); `proof`, `relays`, and `key` are optional facets.
 * @param {*} v
 */
export function isCircleMembershipRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.handle !== 'string' || !v.handle) return false;
  if (typeof v.address !== 'string' || !v.address) return false;
  if (v.proof != null && typeof v.proof !== 'string') return false;
  if (v.relays != null && (!Array.isArray(v.relays) || v.relays.some((r) => typeof r !== 'string'))) return false;
  if (v.key != null && !isKeyRef(v.key)) return false;
  return true;
}

/** Freeze-normalise a record to exactly the known facets (drops unknown fields). Invalid → null. */
export function normaliseCircleMembership(v) {
  if (!isCircleMembershipRecord(v)) return null;
  const rec = { handle: v.handle, address: v.address };
  if (v.proof != null) rec.proof = v.proof;
  if (Array.isArray(v.relays)) rec.relays = Object.freeze([...v.relays]);
  if (v.key != null) rec.key = Object.freeze({ ref: v.key.ref, ...(v.key.posture ? { posture: v.key.posture } : {}) });
  return Object.freeze(rec);
}

/** Read the OWN `{ [circleId]: record }` map straight off one registry entry (no inherit chain). */
export function circleMembershipsOf(entry) {
  const cur = entry?.properties?.[CIRCLE_MEMBERSHIPS_KEY];
  const map = cur?.mode === 'own' ? cur.value : undefined;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

/** One circle's record off an entry, or null. */
export function circleMembershipOf(entry, circleId) {
  return circleMembershipsOf(entry)[circleId] ?? null;
}

/**
 * The wrapped-key-resource ref for a circle off an entry, or null — what a restored device resolves to
 * OPEN pre-wipe content. The load-bearing read of the whole extension.
 */
export function circleKeyRefOf(entry, circleId) {
  return circleMembershipOf(entry, circleId)?.key ?? null;
}

/**
 * Resolve the `{ [circleId]: record }` map through the own/inherit profile graph (a persona inherits
 * its memberships from the default profile unless it declares its own). Mirrors driversFromProperties.
 * @param {(id:string)=>({properties?:object}|null|undefined)} getProfile
 * @param {string} profileId
 * @param {{ defaultProfileId?: string|null }} [opts]
 */
export function circleMembershipsFromProperties(getProfile, profileId, opts = {}) {
  const map = resolveProperty(getProfile, profileId, CIRCLE_MEMBERSHIPS_KEY, opts);
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

/**
 * Upsert one circle's membership record as an OWN property. Returns a NEW frozen properties map
 * (merged onto the current own value, so other circles' records are preserved). Throws on an invalid
 * record — this is restore data; a malformed entry that silently vanished would reproduce the exact
 * "nothing came back" failure.
 * @param {object} properties  the profile's current properties map
 * @param {string} circleId
 * @param {object} record      { handle, address, proof?, relays?, key? }
 */
export function setCircleMembership(properties, circleId, record) {
  if (typeof circleId !== 'string' || !circleId) throw new TypeError('setCircleMembership: circleId required');
  const rec = normaliseCircleMembership(record);
  if (!rec) throw new TypeError('setCircleMembership: invalid membership record (handle + address required)');
  const cur = properties?.[CIRCLE_MEMBERSHIPS_KEY];
  const curMap = (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value))
    ? cur.value
    : {};
  return setOwn(properties, CIRCLE_MEMBERSHIPS_KEY, { ...curMap, [circleId]: rec });
}
