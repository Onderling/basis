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
/** The circles the person LEFT, `{ [circleId]: at }`: a dated tombstone a registry merge honours (a leave is not a plain removal). */
export const CIRCLE_LEFT_KEY = 'circleMembershipsLeft';

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
 * True iff `v` is a well-formed per-circle membership record. `address` is required — it is where you
 * are reachable, and the only field a restore actually needs to re-open a circle. `handle`, `proof`,
 * `relays` and `key` are optional facets.
 *
 * The handle used to be required too, and that quietly excluded the one person who most needs this
 * record: a FOUNDER never redeems an invite, so they never choose a handle, so their own circle was
 * refused a membership entry — and a restored device re-opened everything they had joined and nothing
 * they had started. Measured 2026-09-10 from one paired circle: the creator's recovery file carried
 * 0 circles, the joiner's carried 1. The requirement encoded an assumption that only joiners exist.
 *
 * Readers were already null-tolerant (`memberships[id]?.handle ?? null`), and a handle chosen later
 * merges onto the same record through the ordinary setter.
 * @param {*} v
 */
export function isCircleMembershipRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.handle != null && (typeof v.handle !== 'string' || !v.handle)) return false;
  if (typeof v.address !== 'string' || !v.address) return false;
  if (v.proof != null && typeof v.proof !== 'string') return false;
  if (v.relays != null && (!Array.isArray(v.relays) || v.relays.some((r) => typeof r !== 'string'))) return false;
  if (v.key != null && !isKeyRef(v.key)) return false;
  if (v.sight != null && !isSight(v.sight)) return false;
  if (v.at != null && typeof v.at !== 'string') return false;
  return true;
}

/**
 * The SIGHT facet (opbergen, Frits 2026-09-24): `{ putAway, at }` — the person put this circle out of sight, on every
 * device of theirs, and it wakes nobody. `at` orders the change between devices (the newer wins). A person-level fact
 * about a circle, never a circle statement: the roster does not need to know.
 */
export function isSight(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.putAway === 'boolean' && Number.isFinite(v.at);
}

/** Freeze-normalise a record to exactly the known facets (drops unknown fields). Invalid → null. */
export function normaliseCircleMembership(v) {
  if (!isCircleMembershipRecord(v)) return null;
  const rec = { address: v.address };
  if (v.handle != null) rec.handle = v.handle;
  if (v.proof != null) rec.proof = v.proof;
  if (Array.isArray(v.relays)) rec.relays = Object.freeze([...v.relays]);
  if (v.key != null) rec.key = Object.freeze({ ref: v.key.ref, ...(v.key.posture ? { posture: v.key.posture } : {}) });
  if (v.sight != null) rec.sight = Object.freeze({ putAway: v.sight.putAway, at: v.sight.at });
  // when this record was last written: a registry merge keeps it over an older leave of the same circle, not a newer one
  if (typeof v.at === 'string' && v.at) rec.at = v.at;
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
 * A circle the person LEFT (or was removed from) comes off the profile — with the record still there a restored
 * device re-opened a circle the person had left (found 2026-09-22 while making a leave follow the siblings).
 * A circle not on the record is a no-op; the other records stay.
 */
export function removeCircleMembership(properties, circleId, { at = new Date().toISOString() } = {}) {
  if (typeof circleId !== 'string' || !circleId) throw new TypeError('removeCircleMembership: circleId required');
  const cur = properties?.[CIRCLE_MEMBERSHIPS_KEY];
  const curMap = (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value))
    ? cur.value
    : {};
  // A LEAVE LEAVES A DATED TOMBSTONE: a registry merge of a copy this device has not read (registryCarrier.js) unions
  // the circles, and a plain removal would let a device still holding the circle put it back
  const left = { ...circleLeavesOf({ properties }), [circleId]: at };
  const withTomb = setOwn(properties, CIRCLE_LEFT_KEY, left);
  if (!(circleId in curMap)) return withTomb;
  const { [circleId]: _gone, ...rest } = curMap;
  return setOwn(withTomb, CIRCLE_MEMBERSHIPS_KEY, rest);
}

/** The person's dated leaves off one registry entry, `{ [circleId]: at }` (own, no inherit chain). */
export function circleLeavesOf(entry) {
  const cur = entry?.properties?.[CIRCLE_LEFT_KEY];
  return (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value)) ? { ...cur.value } : {};
}

/**
 * Upsert one circle's membership record as an OWN property. Returns a NEW frozen properties map (other
 * circles' records preserved). This is a FACET MERGE, not a replace: the given `patch` is merged onto any
 * existing record for `circleId`, so a PARTIAL patch — e.g. adding the wrapped-key `{key}` pointer at
 * circle-open, AFTER the `{handle,address}` write-on-join — keeps the facets it does not mention. The
 * MERGED result must still be a valid record (handle + address); a key-only patch for a circle with no
 * prior record throws (there is nothing to attach the key to — callers treat that best-effort). Throwing on
 * an invalid result is deliberate: this is restore data, and an entry that silently vanished would reproduce
 * the exact "nothing came back" failure.
 * @param {object} properties  the profile's current properties map
 * @param {string} circleId
 * @param {object} patch       any subset of { handle, address, proof, relays, key } to merge in
 */
export function setCircleMembership(properties, circleId, patch) {
  if (typeof circleId !== 'string' || !circleId) throw new TypeError('setCircleMembership: circleId required');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('setCircleMembership: record required');
  const cur = properties?.[CIRCLE_MEMBERSHIPS_KEY];
  const curMap = (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value))
    ? cur.value
    : {};
  // Merge the supplied facets onto any existing record (skip undefined/null so a partial patch preserves
  // the rest). Then normalise the RESULT — which enforces handle + address on what actually lands.
  const merged = { ...(curMap[circleId] ?? {}) };
  if (patch.handle != null) merged.handle = patch.handle;
  if (patch.address != null) merged.address = patch.address;
  if (patch.proof != null) merged.proof = patch.proof;
  if (Array.isArray(patch.relays)) merged.relays = patch.relays;
  if (patch.key != null) merged.key = patch.key;
  if (patch.sight != null) merged.sight = patch.sight;
  // dated, so a registry merge can weigh it against a leave of the same circle (removeCircleMembership)
  merged.at = typeof patch.at === 'string' && patch.at ? patch.at : new Date().toISOString();
  const rec = normaliseCircleMembership(merged);
  if (!rec) throw new TypeError('setCircleMembership: invalid membership record (an address is required)');
  return setOwn(properties, CIRCLE_MEMBERSHIPS_KEY, { ...curMap, [circleId]: rec });
}
