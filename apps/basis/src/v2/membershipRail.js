/**
 * membershipRail — membership statements ride THE RAIL (the membership rider, decision A).
 *
 * The membership writers (`@onderling/circles`: redeem → join, leaveGroup → leave, removeMember → evict)
 * already emit signed spine statements; this moves their destination from pinboard's unsynced store to the
 * DEVICE LOG's membership lane — reusing everything the governance rider proved: the declared-kind gate,
 * verify-on-ingest (signature + key↔ref binding — the receiver-enforced eviction guard), the live fan, and
 * the pull-all catch-up. `deriveRoster` folds the rail's VERIFIED bodies (author resolved to ref) as the
 * AUTHORITATIVE membership — the wall-clock exit path retires with this rider.
 */
import { selfRefIn } from './selfRef.js';
import { verifyCeremonyReveal, isCeremonyKind, ceremonyRevealFacts, PERSON_KEY_KIND } from '@onderling/core';
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
export function addressBindsOnRow(row, author, atSeq = null, { hash = null, chainOf = null } = {}) {
  if (!row || typeof author !== 'string' || !author) return false;
  if (row.circleAddress === author) return true;
  if (Array.isArray(row.circleAddresses) && row.circleAddresses.includes(author)) return true;
  if (!Array.isArray(row.retiredAddresses)) return false;
  return row.retiredAddresses.some((r) => {
    if (r?.address !== author) return false;
    // WHERE IT STOPPED, when the retirement says so (a re-key): on the MEMBERSHIP lane, where `upTo` lives and the chain
    // is at hand (`chainOf`), the address binds exactly the statements of its own author chain up to and including
    // `upTo` — the same on every device, in any arrival order; nothing after it. Local arrival order cannot be that cut
    // there (a fresh device may hear the retirement first), nor causal depth (the signer picks its own parents).
    if (typeof r.upTo === 'string' && r.upTo && typeof chainOf === 'function') return typeof hash === 'string' && inAuthorChainUpTo(chainOf, author, r.upTo, hash);
    // a CONTENT lane (chat, items, grants, keys) has no `upTo` in its own chains: the POSITION rule — what landed here
    // before the retirement did still binds. Weaker than the spine's cut (a forged line backdated into the window before
    // the retirement reached this device binds); a per-lane cut is the later fix. Erasing the person's history is worse.
    return Number.isFinite(atSeq) && Number.isFinite(r.atSeq) && atSeq < r.atSeq;
  });
}

/** Is `hash` the statement `upTo` or one of its ancestors along `author`'s own parent chain? `chainOf(hash)` → the body. */
export function inAuthorChainUpTo(chainOf, author, upTo, hash) {
  if (hash === upTo) return true;
  let at = upTo;
  for (let steps = 0; steps < 100000 && at; steps++) {
    const b = chainOf(at);
    if (!b || b.author !== author) return false;   // a gap, or the chain leaves the author: not provably before the cut
    at = b.parentHash ?? null;
    if (at === hash) return true;
  }
  return false;
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
      const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
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
export function membershipBindingVerifier(callSkill, { circleIdentityFor = null, ownCeremonyCommitmentFor = null, memoMs = SPINELESS_MEMO_MS, chainFor = null, storedFor = null } = {}) {
  /** THIS SELF's own retired address, where it stopped: its retirement is on this lane, and its reveal verifies against
   *  this self's OWN commitment (derived from the persona's authority this device holds) — no roster involved. A
   *  device that has just re-keyed and reloaded holds no trail row yet, and its own history must still bind. */
  const ownRetiredCut = (circleId, author, ref) => {
    if (typeof ownCeremonyCommitmentFor !== 'function' || typeof storedFor !== 'function') return null;
    let commitment = null;
    try { commitment = ownCeremonyCommitmentFor(circleId) ?? null; } catch { commitment = null; }
    if (!commitment) return null;
    for (const st of storedFor(circleId) ?? []) {
      const b = st?.body;
      if (b?.kind !== 'address-revoke' || b.subject !== author || typeof b.payload?.upTo !== 'string' || b.payload?.authorRef !== ref) continue;
      const facts = ceremonyRevealFacts({ kind: b.kind, payload: b.payload });
      if (verifyCeremonyReveal(b.payload?.reveal, { circleId, kind: b.kind, subject: author, authorRef: ref, commitment, facts })) return b.payload.upTo;
    }
    return null;
  };
  // Spineless read → no recursion → no breaker (see rosterBindingVerifier above). Two of them: the base binding reads the
  // trail WITH the ceremony retirements folded in (they verify by their root reveal, so folding them reads only the
  // plain trail below — no recursion); the ceremony rule reads the plain trail.
  const memo = new Map();   // `${mode}|${circleId}` → { at, promise, fresh } — fresh: a re-read after a miss
  const keyOf = (circleId, retirements) => `${retirements ? 'r' : 't'}|${circleId}`;
  const held = (circleId, { retirements = true } = {}) => {
    const hit = memo.get(keyOf(circleId, retirements));
    return hit && Date.now() - hit.at < memoMs ? hit : null;
  };
  const spinelessRoster = (circleId, { retirements = true, fresh = false } = {}) => {
    const key = keyOf(circleId, retirements);
    const hit = fresh ? null : held(circleId, { retirements });
    if (hit) return hit.promise;
    const promise = callSkill('pinboard', 'listGroupMembers', { groupId: circleId, spineless: true, ...(retirements ? {} : { withRetirements: false }) });
    memo.set(key, { at: Date.now(), promise, fresh });
    promise.catch(() => memo.delete(key));
    return promise;
  };
  return async ({ author, ref, circleId, kind, payload, subject, own = false, atSeq = null, hash = null }) => {
    try {
      // THE CEREMONY RULE, first and without a self-binding shortcut: even my own device's revoke must
      // carry the root's reveal, or my local fold would accept what every other member refuses.
      if (isCeremonyKind(kind)) {
        // A person announces only their OWN key: the statement's subject is the author's ref, or nothing binds.
        if (kind === PERSON_KEY_KIND && subject !== ref) return false;
        const facts = ceremonyRevealFacts({ kind, payload });
        if (kind === PERSON_KEY_KIND && facts === null) return false;   // malformed announcement — no key, no version
        // The commitment the reveal must match: the row's — or, for this device's OWN statement (its own key, as its own
        // self: the rail says so), the commitment it derives from its self's authority public key (a device holds no row
        // for itself where it founded the circle, and records no commitment of its own). The reveal is required either way.
        let commitment = null;
        if (own && typeof ownCeremonyCommitmentFor === 'function') {
          try { commitment = ownCeremonyCommitmentFor(circleId) ?? null; } catch { commitment = null; }
        }
        if (!commitment) {
          const r = await spinelessRoster(circleId, { retirements: false });   // the plain trail: the retirements fold through here
          const row = (Array.isArray(r?.members) ? r.members : []).find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
          if (!row) return false;
          commitment = row.ceremonyCommitment ?? null;
        }
        return verifyCeremonyReveal(payload?.reveal, {
          circleId, kind, subject, authorRef: ref, commitment, facts,
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
      // …and an address this self RETIRED (a re-key), for exactly its chain up to where it stopped
      if (typeof hash === 'string' && typeof chainFor === 'function') {
        const upTo = ownRetiredCut(circleId, author, ref);
        if (upTo && inAuthorChainUpTo(chainFor(circleId), author, upTo, hash)) return true;
      }
      // SPINELESS, for the same reason as the base verifier above — and memoised for a moment: a fold
      // verifies EVERY statement of a circle, and each verification re-read the whole trail. On the
      // phone that was the roster read running ~1.5×/s continuously and the JS thread so busy that
      // taps were dropped (2026-08-30). One read per burst is the same answer at a fraction of the cost;
      // the window is short enough that a row landing mid-burst is seen by the next one.
      //
      // A MISS IS READ AGAIN, FRESH, ONCE. The window cuts both ways: a statement that arrives right
      // after its author's address row landed (a second device's first act) was refused against the
      // read from just before, though the binding was already true here. A hit stays cheap; only a miss
      // pays one more read, and only when the answer came from a read held over from before (a read this
      // check started is already fresh) that was not itself such a re-read — so a burst of statements
      // that truly do not bind costs one extra read per window, not one each.
      const before = held(circleId);
      const reread = !!before && !before.fresh;
      // a RETIRED address still binds what it signed before it stopped — a re-key retires the address the person's whole
      // earlier history was signed with (the circle's creation, the joins it admitted)
      const binds = (r) => {
        const row = (Array.isArray(r?.members) ? r.members : [])
          .find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
        return !!row && addressBindsOnRow(row, author, atSeq, { hash, chainOf: typeof chainFor === 'function' ? chainFor(circleId) : null });
      };
      if (binds(await spinelessRoster(circleId))) return true;
      if (!reread) return false;
      return binds(await spinelessRoster(circleId, { fresh: true }));
    } catch { return false; }
  };
}

export function makeMembershipRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null, ownCeremonyCommitmentFor = null }) {
  const refIn = selfRefIn(myRef);   // in each circle, the self this device is there
  if (typeof circleIdentityFor !== 'function') return null;
  const railRef = { current: null };
  // the lane's own statements by hash, for the retired-address cut (a chain walk reads them, it verifies nothing)
  const chainFor = (circleId) => {
    const byHash = new Map();
    try { for (const x of railRef.current?.storedStatements?.(circleId) ?? []) if (x?.body?.hash) byHash.set(x.body.hash, x.body); } catch { /* none */ }
    return (h) => byHash.get(h) ?? null;
  };
  const rail = makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: refIn(circleId) }),
    entryKind: MEMBERSHIP_LANE,
    declaredKinds: MEMBERSHIP_RAIL_KINDS,
    verifyBinding: verifyBinding ?? membershipBindingVerifier(callSkill, {
      circleIdentityFor, ownCeremonyCommitmentFor, chainFor,
      storedFor: (circleId) => { try { return railRef.current?.storedStatements?.(circleId) ?? []; } catch { return []; } },
    }),
  });
  railRef.current = rail;
  return rail;
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
  const refIn = selfRefIn(myRef);   // in each circle, the self this device is there
  if (!rail) return null;
  return async function emitSpine({ kind, circleId, subject, payload, actor, signer } = {}) {
    if (kind === 'leave' && subject !== refIn(circleId)) return null;
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
      //
      // A LEAVE waits too (2026-09-22): it is the last thing this device ever says in the circle, and the shells'
      // `leaveCircleLocally` forgets the members' keys and drops the circle's authorize snapshot the moment
      // `leaveGroup` returns — so a fire-and-forget fan resolved its addresses against a device that had just
      // forgotten how to reach anyone, greeted, could not accept the answer, and held the statement for ever. The
      // members learned of the leave only by luck (the journeys leave without the hygiene, so they never saw it);
      // on web and mobile a leave did not travel. Found by the leave-follows relay walk.
      //
      // An ADDRESS-REVOKE waits as well (2026-11-01): when a persona moves to its next circle root (a full device was
      // revoked), retiring the old address is the last thing that address ever says, and the device switches keys the
      // moment the ceremony returns — a fan still in flight then left under the NEW key, which no member authorizes yet,
      // and the retirement never reached them. Found by the full-device re-key walk.
      if (kind === 'evict' || kind === 'leave' || kind === 'address-revoke') {
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
/** `onLanded(circleId, statement, fromPeerAddr)` fires once per NEW statement — the sibling carry's seam. */
export function makeMembershipPeerHandler({ rail, onChange = null, onLanded = null } = {}) {
  if (!rail) throw new Error('makeMembershipPeerHandler: a membership rail is required');
  return async function onCircleMembership(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== MEMBERSHIP_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      // a statement that arrived and was refused says why: a member who never learns of a leave is then the fold's
      // gate, not delivery
      if (res && !res.ok) console.info(`[membership] refused a ${statement?.body?.kind ?? '?'} from ${String(fromPeerAddr ?? '').slice(0, 8)} in ${String(circleId).slice(0, 8)}: ${res.reason ?? '?'}`);
      // …and a leave or an evict that LANDED says so too: with the leaver's line (where each copy went), the two ends of
      // one statement can be read side by side
      if (res?.ok && !res.existed && (statement?.body?.kind === 'leave' || statement?.body?.kind === 'evict')) console.info(`[membership] landed a ${statement.body.kind} from ${String(fromPeerAddr ?? '').slice(0, 8)} in ${String(circleId).slice(0, 8)}`);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
      if (res?.ok && !res.existed && typeof onLanded === 'function') {
        try { await onLanded(circleId, statement, fromPeerAddr); } catch { /* side effects are best-effort */ }
      }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
