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
export const MEMBERSHIP_BROADCAST = 'circle-membership-broadcast';
export const MEMBERSHIP_CATCHUP_SUBTYPES = Object.freeze({
  request: 'circle-membership-catchup-request',
  batch:   'circle-membership-catchup-batch',
});

/** The default key↔ref binding source: the roster's proof-checked circleAddress rows (shared with governance). */
export function rosterBindingVerifier(callSkill) {
  // RE-ENTRANCY BREAKER: the roster projection READS the membership rail, and this verifier is
  // the rail's binding gate — so a binding check that projects the roster recurses back into
  // itself, unboundedly, the first time a FOREIGN membership statement sits on the rail (a
  // self-authored one passes the rail's self-check and never reaches here). On re-entry for the
  // same circle we REFUSE the inner question: the inner projection then folds TRAIL-ONLY — and
  // the trail carries the address facts this verifier needs (the primary + the announced set),
  // so the OUTER check still decides against the right rows. Depth caps at two by construction.
  const inFlight = new Set();
  return async ({ author, ref, circleId }) => {
    if (inFlight.has(circleId)) return false;
    inFlight.add(circleId);
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
    finally { inFlight.delete(circleId); }
  };
}

/** Build the membership rail over the device log. Mirrors `makeGovernanceRail`. */
/**
 * The membership lane's binding — rosterBindingVerifier's semantics plus the CEREMONY rule
 * (custody D1): an `address-revoke` binds ONLY when signed by the row's `ceremonyAddress` — the
 * phrase-derived per-circle key no single device can mint once the custody cutover lands. A row
 * without one (the post-cutover join window, before the member's next ceremony re-binds) falls
 * back to the interim any-attested rule — the arc's named, shrinking window. Same re-entrancy
 * breaker as the base verifier (the roster projection reads this very lane).
 */
export function membershipBindingVerifier(callSkill) {
  const inFlight = new Set();
  return async ({ author, ref, circleId, kind }) => {
    if (inFlight.has(circleId)) return false;
    inFlight.add(circleId);
    try {
      const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
      const row = (Array.isArray(r?.members) ? r.members : [])
        .find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
      if (!row) return false;
      if (kind === 'address-revoke' && typeof row.ceremonyAddress === 'string' && row.ceremonyAddress) {
        return author === row.ceremonyAddress;
      }
      return row.circleAddress === author
        || (Array.isArray(row.circleAddresses) && row.circleAddresses.includes(author));
    } catch { return false; }
    finally { inFlight.delete(circleId); }
  };
}

export function makeMembershipRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (typeof circleIdentityFor !== 'function') return null;
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: MEMBERSHIP_LANE,
    declaredKinds: MEMBERSHIP_RAIL_KINDS,
    verifyBinding: verifyBinding ?? membershipBindingVerifier(callSkill),
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
  return async function emitSpine({ kind, circleId, subject, payload, actor, signer } = {}) {
    if (kind === 'leave' && subject !== myRef) return null;
    const res = await rail.append(circleId, { kind, subject, payload, actor, signer });
    if (!res) return null;
    if (typeof fan === 'function') {
      try { fan(circleId, res.statement); } catch { /* fan is best-effort — never block the writer */ }
    }
    return res.statement;
  };
}

/** Peer handler for `circle-membership-broadcast` → the rail's full ingest gate (verify + declared kind +
 *  key↔ref binding) before a fanned statement lands on this device's log. Signed-only, like governance. */
export function makeMembershipPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeMembershipPeerHandler: a membership rail is required');
  return async function onCircleMembership(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== MEMBERSHIP_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
