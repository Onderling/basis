/**
 * keyRail — the group-key lane: sealed key envelopes as SIGNED SPINE STATEMENTS on the device log.
 *
 * Implements the recorded route (docs/architecture.md §"Consistency & governance" + the three
 * append channels; docs/decisions.md 2026-07-25, re-ratified 2026-08-16): key rotations are spine
 * material — equivocation is an attack (key-splitting: serving different "current" keys to
 * different members), so each key-event rides a per-author chained, circle-signed statement, and
 * two rotations off one parent are a self-verifying fork-proof. The sealed envelope itself is the
 * statement's PAYLOAD, untouched: the pod-client machinery (establish/rotate/fold/open) neither
 * knows nor cares that its events now travel signed.
 *
 * AUTHORITY (the L4 decision-class, receiver-enforced like the rules-update rider):
 *   · `key-establish` (version 1) — the author must hold the ADMIN role (the creator is the
 *     admin at sealing time; founder-authority in ref space, same family as the roster fold).
 *   · `key-rotate` — governed by the circle policy's `rotateKey` class. The recorded default is
 *     `any-admin`: the author must hold the admin role. A circle whose class is STRICTER
 *     (admin-quorum / member-vote) refuses a bare rotation — fail closed — until the rotation
 *     statement can carry its resolving governance decision (the resolve-reference linkage, a
 *     named follow-up). The class hook is injected; absent, the ratified default applies.
 *
 * DISPUTE (the L3 rule, as built for governance): a forked author is DISPUTED and their
 * statements are DISCOUNTED — the projected chain simply stays at the last undisputed head, so
 * members keep sealing under it and the contested version is never adopted. Deny-wins, softly.
 */
import { makeCircleEntryRail } from './circleEntryRail.js';
import { KEY_LANE } from './keyManifest.js';

export const KEY_RAIL_KINDS = ['key-establish', 'key-rotate'];

/** The wire subtype a fanned key statement rides (replaces the retired raw `group-key-event` door). */
export const KEY_STATEMENT_BROADCAST = 'circle-key-statement';

/** The key lane's catch-up pair (pull-all — the chain is one small statement per version). */
export const KEY_CATCHUP_SUBTYPES = Object.freeze({
  request: 'circle-key-catchup-request',
  batch: 'circle-key-catchup-batch',
});

/**
 * The key lane's binding — the base roster rule (author key ∈ the ref's proven address set) PLUS
 * the authority rule above. Spineless roster reads, like every binding verifier (no recursion).
 *
 * @param {Function} callSkill
 * @param {{rotateClassFor?: (circleId:string)=>Promise<string>|string}} [opts]
 *   the circle's `rotateKey` decision-class; absent → the ratified default `any-admin`.
 */
export function keyBindingVerifier(callSkill, { rotateClassFor = null } = {}) {
  return async ({ author, ref, circleId, kind, payload }) => {
    try {
      const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId, spineless: true });
      const row = (Array.isArray(r?.members) ? r.members : [])
        .find((m) => m && (m.webid ?? m.addr ?? m.ref) === ref);
      if (!row) return false;
      const keyBinds = row.circleAddress === author
        || (Array.isArray(row.circleAddresses) && row.circleAddresses.includes(author));
      if (!keyBinds) return false;
      // The authority rule — receiver-enforced, so a sender cannot pick a weaker one.
      if (kind === 'key-establish') {
        if (payload?.event?.version !== 1) return false;   // an establish IS version 1, by definition
        return row.role === 'admin';
      }
      if (kind === 'key-rotate') {
        let cls = 'any-admin';
        if (typeof rotateClassFor === 'function') {
          try { cls = (await rotateClassFor(circleId)) ?? 'any-admin'; } catch { cls = 'any-admin'; }
        }
        // Stricter classes fail CLOSED until rotations carry their resolving decision.
        if (cls !== 'any-admin') return false;
        return row.role === 'admin';
      }
      return false;   // an undeclared kind never binds (the rail refuses it earlier anyway)
    } catch { return false; }
  };
}

/** Build the key rail over the device log. Mirrors `makeMembershipRail`. */
export function makeKeyRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null, rotateClassFor = null } = {}) {
  if (typeof circleIdentityFor !== 'function') return null;
  return makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: KEY_LANE,
    declaredKinds: KEY_RAIL_KINDS,
    verifyBinding: verifyBinding ?? keyBindingVerifier(callSkill, { rotateClassFor }),
  });
}

/**
 * The emit half the key-event SINK calls: wrap a raw key-event as a signed lane statement and
 * append it (the device log IS the local record — the projection below feeds the fold's store).
 * Returns the statement for the sink to fan, or null when no circle signer resolves.
 */
export function makeKeyEmitter({ rail }) {
  if (!rail) return null;
  return async function emitKeyStatement(circleId, event) {
    if (!event || !Number.isInteger(event.version)) return null;
    const kind = event.version === 1 ? 'key-establish' : 'key-rotate';
    const res = await rail.append(circleId, {
      kind,
      subject: `v${event.version}`,
      // The raw sealed key-event rides as-is — the fold's input, byte-identical to what the
      // sealing machinery emitted. Nothing here can read it; nothing here needs to.
      payload: { event },
    });
    return res?.statement ?? null;
  };
}

/** The receive half: verify-and-land a fanned key statement at the rail. Mirrors the other lanes. */
export function makeKeyPeerHandler({ rail, onChange = null }) {
  return async function handleKeyStatement(_fromAddr, payload) {
    if (!payload || payload.subtype !== KEY_STATEMENT_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement) return;
    try {
      const r = await rail.ingest(circleId, statement);
      if (r?.ok && !r.existed && typeof onChange === 'function') { try { onChange(circleId); } catch { /* observer */ } }
    } catch { /* refusal is silent — catch-up reconciles */ }
  };
}

/**
 * THE PROJECTION — the circle's key-events, folded from VERIFIED lane bodies with the L3
 * discount applied PREFIX-PRESERVING: a fork-proof proves dishonesty FROM THE FORK POINT — the
 * shared prefix below it is signed into BOTH halves by the forker themselves, the one thing even
 * the equivocator agrees on. So a disputed author keeps their statements up to the fork's shared
 * parent and loses everything at and after it: the chain stays at the LAST UNDISPUTED HEAD (the
 * recorded rule, literally) — a contested rotation never becomes anyone's current key, and the
 * circle keeps reading and sealing at the last honest version instead of going dark entirely.
 * The result feeds `foldKeyEvents`/`readKeyChain` unchanged; `createKeyEventStore` consumers
 * refresh their store from this (replace-not-patch — see `projectKeyEventsIntoStore`).
 */
export async function keyEventsFromRail(rail, circleId) {
  if (!rail) return [];
  const { bodies } = await rail.readVerifiedBodies(circleId);
  const laneBodies = bodies.filter((b) => KEY_RAIL_KINDS.includes(b.kind) && b.payload?.event);
  // Fork points per author: a parent two statements share marks the split. Everything from that
  // parent's CHILDREN onward is contested; the parent itself and its ancestry are the agreed prefix.
  const forkParentsByAuthor = new Map();   // author → Set(shared parentHash)
  const seen = new Map();                  // `${author}|${parent}` → count
  for (const b of laneBodies) {
    const k = `${b.author}|${b.parentHash ?? ''}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) {
      const set = forkParentsByAuthor.get(b.author) ?? new Set();
      set.add(b.parentHash ?? '');
      forkParentsByAuthor.set(b.author, set);
    }
  }
  // Walk each disputed author's own chain from its root; KEEP only what the walk reaches clean
  // (the agreed prefix, up to but excluding the fork's children). A statement the walk cannot
  // place — its local ancestry is missing — drops too: unknown position on a forked chain is
  // contested until the chain fills in (conservative; the catch-up's pull-all fills gaps).
  const keptOfDisputed = new Set();
  for (const [author, forkParents] of forkParentsByAuthor) {
    const byParent = new Map();            // parentHash → [bodies] (this author only)
    for (const b of laneBodies) {
      if (b.author !== author) continue;
      const p = b.parentHash ?? '';
      byParent.set(p, [...(byParent.get(p) ?? []), b]);
    }
    const walk = (parentKey) => {
      if (forkParents.has(parentKey)) return;   // the fork point: its children are the contested halves
      for (const b of (byParent.get(parentKey) ?? [])) {
        keptOfDisputed.add(b.hash);
        walk(b.hash);
      }
    };
    walk('');
  }
  return laneBodies
    .filter((b) => !forkParentsByAuthor.has(b.author) || keptOfDisputed.has(b.hash))
    .map((b) => b.payload.event);
}

/**
 * Refresh a `createKeyEventStore` from the lane — the store is the lane's materialised head,
 * REPLACED wholesale so a version a later fork-proof discounts disappears from it too (an
 * additive record could never take a contested version back).
 */
export async function projectKeyEventsIntoStore({ rail, store, circleId }) {
  if (!rail || !store || typeof store.replaceCircle !== 'function') return 0;
  return store.replaceCircle(circleId, await keyEventsFromRail(rail, circleId));
}

export default makeKeyRail;
