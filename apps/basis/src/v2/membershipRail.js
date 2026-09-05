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
import { verifyCeremonyReveal } from '@onderling/core';
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
/** How long one spineless roster read serves a verification burst (a fold verifies every statement). */
export const SPINELESS_MEMO_MS = 300;

/**
 * Does `author` bind to this roster row for a statement at log position `atSeq`? Live addresses always;
 * a RETIRED address only for statements that landed on this device's log BEFORE the retirement did
 * (`row.retiredAddresses`, each with the `atSeq` of its revocation as folded here). Revocation cuts the
 * future, not the past: a revoked device's earlier key events, tasks and votes stay verifiable, while
 * anything that arrives after — including a backdated statement, whose writer-stamped time is never
 * consulted — is refused. A retirement whose position is unknown retires everything (deny-favouring).
 */
export function addressBindsOnRow(row, author, atSeq = null) {
  if (!row || typeof author !== 'string' || !author) return false;
  if (row.circleAddress === author) return true;
  if (Array.isArray(row.circleAddresses) && row.circleAddresses.includes(author)) return true;
  if (!Array.isArray(row.retiredAddresses) || !Number.isFinite(atSeq)) return false;
  return row.retiredAddresses.some((r) => r?.address === author && Number.isFinite(r.atSeq) && atSeq < r.atSeq);
}

export function rosterBindingVerifier(callSkill) {
  // NO re-entrancy breaker, BY CONSTRUCTION (2026-08-21): this verifier reads the roster
  // SPINELESS (trail + display only), so verifying a statement never re-enters the statement
  // fold — there is no recursion left to break. The old per-circle inFlight breaker could not
  // tell recursion from CONCURRENT SIBLING reads and refused valid statements nondeterministically
  // (roster stamps oscillated per read on a seeded device — the bug that forced this design).
  return async ({ author, ref, circleId, atSeq = null }) => {
    try {
      // The DERIVED roster (`listGroupMembers`) is the projection that carries the address facts:
      // `webid` + the primary `circleAddress` + the proven `circleAddresses` SET (each entry
      // admitted to the fold only through its own circle-link proof). The flat routing list
      // (`listGroupRoster`) this used to read carries NEITHER field — every foreign statement
      // failed the binding by shape, invisibly, because the test harness substituted its own
      // resolver: the three-device walk was the first thing to run the verifier for real.
      // THE FULL read — spine folded (F-019, 2026-08-23).
      //
      // This read used to be SPINELESS (trail + display only), to guarantee that verifying a
      // statement never re-enters the statement fold. The guarantee is right; the scope was too
      // wide. An EVICTION is a spine statement, so a spineless reader cannot see it — and a removed
      // member therefore still bound, on every content lane. Measured: after a legitimate removal
      // their fan resolved the remaining members, the send reported `{sent: 2, errors: []}`, and the
      // statement landed and was stored at the bystander. The eviction did not hold on chat.
      //
      // Why folding here is safe, stated so the next reader does not have to re-derive it: the
      // recursion risk is a lane verifying against ITS OWN lane. This verifier serves the CONTENT
      // lanes (chat · tasks · governance), and it folds MEMBERSHIP — a different lane, no cycle. The
      // chain terminates at the membership lane's own verifier (`membershipBindingVerifier` below),
      // which keeps the spineless read and is the base case:
      //
      //   chat statement → this verifier → full roster → membership fold
      //     → membershipBindingVerifier → SPINELESS roster → no fold. Terminates.
      //
      // The rule, in one line: a content lane verifies against the membership FOLD; the membership
      // lane verifies against the TRAIL.
      const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
      // SET-AWARE (add-a-device): a statement signed at ANY of the member's proven addresses
      // binds to the member; checking the primary alone would refuse every second device's
      // statements on every rail.
      return (Array.isArray(r?.members) ? r.members : []).some((m) =>
        m && (m.webid ?? m.addr ?? m.ref) === ref && addressBindsOnRow(m, author, atSeq));
    } catch { return false; }
  };
}

/** Build the membership rail over the device log. Mirrors `makeGovernanceRail`. */
/**
 * The membership lane's binding — rosterBindingVerifier's semantics plus the CEREMONY rule: an
 * `address-revoke` binds ONLY by its ROOT REVEAL — the owner root's public key plus the root's signature
 * over this statement's facts — verified against the row's `ceremonyCommitment` (core
 * ceremonyCommitment.js). The root exists only inside a ceremony, so no device, stolen or not, can mint
 * one; the author key is simply whichever device ran the ceremony. A row with no commitment cannot be
 * revoked by statement at all — deny, never the any-attested rule. Spineless roster reads, like the base
 * verifier (no recursion, no breaker).
 */
export function membershipBindingVerifier(callSkill, { circleIdentityFor = null, memoMs = SPINELESS_MEMO_MS } = {}) {
  // Spineless read → no recursion → no breaker (see rosterBindingVerifier above).
  const memo = new Map();   // circleId → { at, promise }
  const spinelessRoster = (circleId) => {
    const hit = memo.get(circleId);
    if (hit && Date.now() - hit.at < memoMs) return hit.promise;
    const promise = callSkill('stoop', 'listGroupMembers', { groupId: circleId, spineless: true });
    memo.set(circleId, { at: Date.now(), promise });
    promise.catch(() => memo.delete(circleId));
    return promise;
  };
  return async ({ author, ref, circleId, kind, payload, subject }) => {
    try {
      // THE CEREMONY RULE, first and without a self-binding shortcut: even my own device's revoke must
      // carry the root's reveal, or my local fold would accept what every other member refuses.
      if (kind === 'address-revoke') {
        const r = await spinelessRoster(circleId);
        const row = (Array.isArray(r?.members) ? r.members : []).find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
        return !!row && verifyCeremonyReveal(payload?.reveal, {
          circleId, kind, subject, authorRef: ref, commitment: row.ceremonyCommitment,
        });
      }
      // SELF-BINDING — a device can always verify its OWN key, with no roster involved. This is the
      // only way out of a genuine circularity: the roster of a brand-new circle is empty, so the
      // creator's own first statement could not bind, so the roster stayed empty. Proving "I signed
      // this with my per-circle key for this circle" grants no authority — the fold still decides
      // whether that ref may do anything — it only lets a device attest its own signature.
      if (typeof circleIdentityFor === 'function') {
        try {
          const mine = await circleIdentityFor(circleId);
          if (mine?.pubKey && mine.pubKey === author) return true;
        } catch { /* fall through to the roster read */ }
      }
      // SPINELESS, for the same reason as the base verifier above — and memoised for a moment: a fold
      // verifies EVERY statement of a circle, and each verification re-read the whole trail. On the
      // phone that was the roster read running ~1.5×/s continuously and the JS thread so busy that
      // taps were dropped (2026-08-30). One read per burst is the same answer at a fraction of the cost;
      // the window is short enough that a row landing mid-burst is seen by the next one.
      const r = await spinelessRoster(circleId);
      const row = (Array.isArray(r?.members) ? r.members : [])
        .find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
      if (!row) return false;
      return row.circleAddress === author
        || (Array.isArray(row.circleAddresses) && row.circleAddresses.includes(author));
    } catch { return false; }
  };
}

export function makeMembershipRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (typeof circleIdentityFor !== 'function') return null;
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: MEMBERSHIP_LANE,
    declaredKinds: MEMBERSHIP_RAIL_KINDS,
    verifyBinding: verifyBinding ?? membershipBindingVerifier(callSkill, { circleIdentityFor }),
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
      // Fire-and-forget, EXCEPT for an eviction. A slow fan must never block a local write, which is
      // right for every kind but one: `evict` is the only statement whose recipient is about to become
      // unreachable. `removeMember` emits it and then rotates the key and drops the member from the
      // MemberMap — and the fan resolves its addresses when it finally runs, by which point the person
      // it is about is gone from the map it resolves against. `resolveMemberAddress` then returns
      // `blocked-by-setting` (no per-circle address, and routing over a global key is refused by the
      // privacy default) and the notice is not sent at all.
      //
      // That is why a removed member's device showed an unchanged circle, an unchanged roster and a
      // working composer, with nothing in its console: nothing had reached it (walked 2026-08-27).
      // Reordering the caller does not fix it — the race is here, not there.
      //
      // So an evict WAITS for its fan. It costs one send on the one path where a person is being told
      // something they cannot be told later, and the caller still completes if it fails: the await is
      // wrapped, and `removeMember` reports `told` either way.
      if (kind === 'evict') {
        try { await fan(circleId, res.statement); } catch { /* reported by the caller as told:false */ }
      } else {
        try { fan(circleId, res.statement); } catch { /* fan is best-effort — never block the writer */ }
      }
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
