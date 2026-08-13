/**
 * membershipRail — membership statements ride THE RAIL (the membership rider, decision A).
 *
 * The membership writers (`@onderling/circles`: redeem → join, leaveGroup → leave, removeMember → evict)
 * already emit signed spine statements; this moves their destination from stoop's unsynced store to the
 * DEVICE LOG's membership lane — reusing everything the governance rider proved: the declared-kind gate,
 * verify-on-ingest (signature + key↔ref binding — the receiver-enforced eviction guard), the live fan, and
 * the pull-all catch-up. `deriveRoster` folds the rail's VERIFIED bodies (author resolved to ref) as the
 * AUTHORITATIVE membership — the wall-clock exit path retires with this rider.
 */
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { membershipManifest, MEMBERSHIP_LANE } from './membershipManifest.js';

/** The statement kinds the membership lane carries — DERIVED from the manifest's declared appends. */
export const MEMBERSHIP_RAIL_KINDS = entryKindRegistryFromManifests(membershipManifest).kindsFor(MEMBERSHIP_LANE);

/** The wire subtypes for the membership lane's fan + catch-up (the governance pair's sibling). */
export const MEMBERSHIP_BROADCAST = 'kring-membership-broadcast';
export const MEMBERSHIP_CATCHUP_SUBTYPES = Object.freeze({
  request: 'kring-membership-catchup-request',
  batch:   'kring-membership-catchup-batch',
});

/** The default key↔ref binding source: the roster's proof-checked circleAddress rows (shared with governance). */
export function rosterBindingVerifier(callSkill) {
  return async ({ author, ref, circleId }) => {
    try {
      // The DERIVED roster (`listGroupMembers`) is the projection that carries the address facts:
      // `webid` + the primary `circleAddress` + the proven `circleAddresses` SET (each entry
      // admitted to the fold only through its own circle-link proof). The flat routing list
      // (`listGroupRoster`) this used to read carries NEITHER field — every foreign statement
      // failed the binding by shape, invisibly, because the test harness substituted its own
      // resolver: the three-device walk was the first thing to run the verifier for real.
      const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
      // SET-AWARE (add-a-device): a statement signed at ANY of the member's proven addresses
      // binds to the member; checking the primary alone would refuse every second device's
      // statements on every rail.
      return (Array.isArray(r?.members) ? r.members : []).some((m) =>
        m
        && (m.webid ?? m.addr ?? m.ref) === ref
        && (m.circleAddress === author
          || (Array.isArray(m.circleAddresses) && m.circleAddresses.includes(author))));
    } catch { return false; }
  };
}

/** Build the membership rail over the device log. Mirrors `makeGovernanceRail`. */
export function makeMembershipRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (typeof circleIdentityFor !== 'function') return null;
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: MEMBERSHIP_LANE,
    declaredKinds: MEMBERSHIP_RAIL_KINDS,
    verifyBinding: verifyBinding ?? rosterBindingVerifier(callSkill),
  });
}

/**
 * The emitSpine-compatible adapter the membership writers call (`emitSpine({kind, circleId, subject,
 * payload, actor})` → the signed statement, or null). Appends to the rail, then hands the STATEMENT to the
 * injected fan (best-effort — the local write never blocks on delivery).
 *
 * The self-leave guard lives here (author==subject in REF space — a leave for anyone else is a dead
 * statement the fold discards; never persist one). Joins/evicts are authority-checked at the fold.
 */
export function makeMembershipEmitter({ rail, myRef, fan = null }) {
  if (!rail) return null;
  return async function emitSpine({ kind, circleId, subject, payload, actor } = {}) {
    if (kind === 'leave' && subject !== myRef) return null;
    const res = await rail.append(circleId, { kind, subject, payload, actor });
    if (!res) return null;
    if (typeof fan === 'function') {
      try { fan(circleId, res.statement); } catch { /* fan is best-effort — never block the writer */ }
    }
    return res.statement;
  };
}

/** Peer handler for `kring-membership-broadcast` → the rail's full ingest gate (verify + declared kind +
 *  key↔ref binding) before a fanned statement lands on this device's log. Signed-only, like governance. */
export function makeMembershipPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeMembershipPeerHandler: a membership rail is required');
  return async function onKringMembership(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== MEMBERSHIP_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
