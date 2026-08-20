/**
 * grantsRail — connection grants ride THE RAIL between a person's OWN devices (V1 closing wave, row 1).
 *
 * A connection/grant is a property of the PERSON, not of the device it was paired on. Grant and
 * revoke statements ride the device log's grants lane — reusing everything the circle riders proved
 * (the declared-kind gate, verify-on-ingest, the live fan, the pull-all catch-up) with ONE change:
 * the lane's trust base is not a circle roster but the owner's own device set. A statement binds
 * when its author key is provably one of the owner's devices:
 *
 *   • the PROFILE key itself (the chat identity every device of the profile derives from the same
 *     seed) — the floor, and the signing key of an unenrolled first device; or
 *   • an enrolled device's DELEGATION key, proven by the root-signed delegation record the
 *     statement carries: the record's pubKey is the author, the root signature verifies, and the
 *     signing root's fingerprint is THIS device's own root fingerprint (the "same person" tag both
 *     custody modes hold) — so a sibling verifies without the owner's (pod-synced, possibly
 *     absent) registry. The registry is consulted only for the deny-wins tombstone: a record
 *     marked `revoked: true` there stops binding, whatever it carries.
 *
 * The lane is scope-keyed on ONE constant (`own-devices`) where a circle rail carries a circleId —
 * the mechanics (serialised append/ingest, chaining, fork detection) are unchanged.
 */
import { verifyDeviceDelegation, ownerRootFingerprint } from '@onderling/core';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { grantsManifest, GRANTS_LANE, OWN_DEVICES_SCOPE } from './grantsManifest.js';
import { makeGovernanceCatchUp } from './governanceCatchUp.js';

export { GRANTS_LANE, OWN_DEVICES_SCOPE };

/** The statement kinds the grants lane carries — DERIVED from the manifest's declared appends. */
export const GRANTS_RAIL_KINDS = entryKindRegistryFromManifests(grantsManifest).kindsFor(GRANTS_LANE);

/** The wire subtypes for the grants lane's fan + catch-up (the circle riders' sibling pair). */
export const GRANTS_BROADCAST = 'device-grants-broadcast';
export const GRANTS_CATCHUP_SUBTYPES = Object.freeze({
  request: 'device-grants-catchup-request',
  batch:   'device-grants-catchup-batch',
});

/**
 * The grants lane's key↔owner binding — the device-set trust base described above.
 *
 * @param {object} a
 * @param {string} a.selfPubKey  the profile's chat pubKey (the one ref this lane admits, and the floor key)
 * @param {string|null} [a.rootFingerprint]  this device's owner-root fingerprint (root custody derives it;
 *   delegation custody carries it on the marker). Absent → carried records cannot bind (floor + registry only).
 * @param {(() => Promise<object>|object)|null} [a.lookupDelegations]  the owner's `{[deviceId]: record}`
 *   delegation map (best-effort; the registry). Source of the deny-wins tombstone and the no-record fallback.
 */
export function deviceSetBindingVerifier({ selfPubKey, rootFingerprint = null, lookupDelegations = null } = {}) {
  if (typeof selfPubKey !== 'string' || !selfPubKey) {
    throw new Error('deviceSetBindingVerifier: selfPubKey required');
  }
  const delegations = async () => {
    try { return (await lookupDelegations?.()) ?? {}; } catch { return {}; }
  };
  return async ({ author, ref, payload }) => {
    // One person on this lane: every statement's ref IS the profile.
    if (ref !== selfPubKey) return false;
    // The floor: the profile key itself — held only by the owner's devices (same-seed derivation).
    if (author === selfPubKey) return true;

    const map = await delegations();
    // The carried record: root-signed, self-certifying against this device's own root fingerprint.
    const rec = payload?.delegation;
    if (rec && typeof rec === 'object' && rec.pubKey === author && verifyDeviceDelegation(rec)) {
      if (map[rec.deviceId]?.revoked === true) return false;   // deny wins — the tombstone refuses
      if (rootFingerprint && ownerRootFingerprint(rec.by) === rootFingerprint) return true;
    }
    // No usable carried record: the registry's own record for this key (already owner-scoped).
    for (const r of Object.values(map)) {
      if (r && r.pubKey === author && r.revoked !== true && verifyDeviceDelegation(r)) return true;
    }
    return false;
  };
}

/**
 * Build the grants rail over the device log. Mirrors `makeMembershipRail`, with a CONSTANT signer
 * (the device-derivation identity — delegation key when enrolled, the profile key on an unenrolled
 * first device) and the device-set binding verifier.
 *
 * @param {object} a
 * @param {object} a.eventLog  the device log
 * @param {() => Promise<{identity: object, ref: string}>} a.signerFor  resolves the device signer
 * @param {Function} a.verifyBinding  `deviceSetBindingVerifier(...)`
 */
export function makeGrantsRail({ eventLog, signerFor, verifyBinding }) {
  return makeCircleEntryRail({
    eventLog,
    signerFor,
    entryKind: GRANTS_LANE,
    declaredKinds: GRANTS_RAIL_KINDS,
    verifyBinding,
  });
}

/**
 * Peer handler for `device-grants-broadcast` → the rail's full ingest gate (verify + declared kind
 * + device-set binding) before a fanned statement lands on this device's log. Signed-only.
 */
export function makeGrantsPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeGrantsPeerHandler: a grants rail is required');
  return async function onDeviceGrants(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== GRANTS_BROADCAST) return;
    const statement = payload.event;
    if (!statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(OWN_DEVICES_SCOPE, statement);
      if (res?.ok && typeof onChange === 'function') { try { await onChange(); } catch { /* best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}

/**
 * The addresses of MY OTHER devices — the proven per-circle address set my OWN roster rows carry
 * (add-a-device's boot re-announce puts every enrolled device's address in every roster's set),
 * minus this device's own addresses. This is deliberately not a new address class: a sibling is
 * reached exactly where a circle peer would reach it. A circle-less person's devices have no live
 * fan target — restore-time is the designed floor there.
 *
 * @param {object} a
 * @param {Function} a.callSkill
 * @param {string} a.selfPubKey  the profile's chat pubKey (my roster rows' webid)
 * @param {(circleId: string) => string|null} a.circleAddressFor  this device's own per-circle address
 * @returns {Promise<string[]>} deduped sibling addresses
 */
export async function siblingDeviceAddresses({ callSkill, selfPubKey, circleAddressFor }) {
  const out = new Set();
  let circles = [];
  try { circles = (await callSkill('stoop', 'listMyCircles', {}))?.circles ?? []; } catch { return []; }
  for (const c of circles) {
    // `listMyCircles` answers plain circle-id strings on this composition; other hosts answer rows.
    const circleId = typeof c === 'string' ? c : (c?.groupId ?? c?.id);
    if (typeof circleId !== 'string' || !circleId) continue;
    let members = [];
    try { members = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? []; } catch { continue; }
    const mine = members.find((m) => m && (m.webid ?? m.addr ?? m.ref) === selfPubKey);
    if (!mine) continue;
    let own = null;
    try { own = circleAddressFor?.(circleId) ?? null; } catch { own = null; }
    const set = [
      ...(Array.isArray(mine.circleAddresses) ? mine.circleAddresses : []),
      ...(typeof mine.circleAddress === 'string' && mine.circleAddress ? [mine.circleAddress] : []),
    ];
    for (const addr of set) {
      if (typeof addr === 'string' && addr && addr !== own && addr !== selfPubKey) out.add(addr);
    }
  }
  return [...out];
}

/**
 * The live fan: hand a freshly appended grant statement to every sibling device (hold-forward,
 * like every durable fan — an offline sibling gets it on reconnect). Best-effort and REPORTING:
 * catch-up reconciles a miss either way, but the log says when it will have to.
 */
export function makeGrantsFan({ siblings, sendToPeer }) {
  return async function fanGrantStatement(statement) {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { addrs = []; }
    await Promise.all(addrs.map(async (addr) => {
      try { await sendToPeer(addr, { subtype: GRANTS_BROADCAST, event: statement }); }
      catch (err) {
        console.warn(`[grants-lane] fan to sibling failed (catch-up will reconcile): ${err?.message ?? err}`);
      }
    }));
    return { attempted: addrs.length };
  };
}

/**
 * Pull-all catch-up for the grants lane — the same lane-parametrized mechanism the membership lane
 * reuses (`makeGovernanceCatchUp`), pointed at the sibling set instead of circle rosters. Serving
 * defaults to the SIBLING CHECK: the requester must present a known own-device address (or the
 * profile key itself) — grant metadata is the owner's business, not a circle's.
 *
 * @returns the catch-up trio plus `requestFromSiblings()` — the boot/reconnect kick.
 */
export function makeGrantsCatchUp({ rail, sendToPeer, siblings, selfPubKey, onChange = null, mayServe = null } = {}) {
  const serve = mayServe ?? (async (fromPeerAddr) => {
    if (fromPeerAddr === selfPubKey) return true;
    try { return ((await siblings()) ?? []).includes(fromPeerAddr); } catch { return false; }
  });
  const inner = makeGovernanceCatchUp({
    rail, sendToPeer, onChange, subtypes: GRANTS_CATCHUP_SUBTYPES,
    mayServe: (fromPeerAddr) => serve(fromPeerAddr),
  });
  return {
    onRequest: inner.onRequest,
    onBatch:   inner.onBatch,
    subtypes:  inner.subtypes,
    /** Ask every sibling for the grants lane. Any ONE complete answer suffices (idempotent ingest). */
    async requestFromSiblings() {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { requested: 0 }; }
      let requested = 0;
      for (const addr of addrs) {
        try { await inner.requestFrom(addr, OWN_DEVICES_SCOPE); requested += 1; } catch { /* next sibling */ }
      }
      return { requested };
    },
  };
}
