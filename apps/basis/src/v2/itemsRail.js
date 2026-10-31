/**
 * itemsRail — task items ride THE RAIL (the content re-root, tasks first).
 *
 * The items lane is the first CONTENT lane: no authority fold — the truth about a task is its materialised
 * STORE ROW, and the lane's job is to carry each writer's row (a full-item snapshot, signed with the
 * per-circle key) to the circle's other devices, where it lands through the SAME causal merge every store
 * ingest uses (`put(..., {sync:false, origin:true})`: content LWW on the Lamport clock + the claim fold, so
 * the CAS guarantee and the writer-computed claim cluster — claimSeq, confirmation, `confirmedSig` — arrive
 * intact). The statement signature authenticates the CARRIER (whoever fanned it); the item's own authorship
 * facts (`updatedBy`, `confirmedSig`) travel inside the snapshot and are judged by the merge, so a
 * republished head remains as valid as a fresh write.
 *
 * This lane replaces the unsigned peer-mirror carry for task items (per-type one-path): the store's publish
 * hook routes every circle-content publish onto the lane — see `routeItemsMirror` (unsigned carry deleted).
 */
import { selfRefIn } from './selfRef.js';
import { isLaneCarriedItem } from '@onderling/circles';
import { signSpine, authorHead, frontier } from '@onderling/core';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { itemsManifest, ITEMS_LANE } from './itemsManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';

/** The statement kinds the items lane carries — DERIVED from the manifest's declared appends. */
export const ITEMS_RAIL_KINDS = entryKindRegistryFromManifests(itemsManifest).kindsFor(ITEMS_LANE);

/*
 * There is deliberately NO list of item types here. Whatever the circle's store holds rides this lane: the
 * store's registry already decided what may be written, and a second list at the valve could only disagree
 * with it — a type the registry accepted but the list did not know (an announcement, a calendar entry, the
 * next feature's rows) silently never reached a device that was away. The publish valve has no type gate
 * either (`routeItemsMirror`); catch-up below serves every row the store has a head for.
 */

/** The wire subtypes for the items lane's fan + catch-up (the governance/membership pairs' sibling). */
export const ITEMS_BROADCAST = 'circle-items-broadcast';
export const ITEMS_CATCHUP_SUBTYPES = Object.freeze({
  request: 'circle-items-catchup-request',
  batch:   'circle-items-catchup-batch',
  offer:   'circle-items-catchup-offer',
});
/** The same replay for the person's OWN scope — its own wire pair, asked of and served to the person's devices only. */
export const OWN_ITEMS_CATCHUP_SUBTYPES = Object.freeze({
  request: 'own-items-catchup-request',
  batch:   'own-items-catchup-batch',
  offer:   'own-items-catchup-offer',
});

/**
 * Build the items rail over the device log. Mirrors `makeMembershipRail`, with one addition: a VERIFIED
 * ingest also APPLIES the statement to the circle's store head (the causal merge), so every arrival path —
 * live fan and catch-up alike — materialises without extra wiring.
 *
 * @param {object} a
 * @param {object} a.eventLog            the device log
 * @param {(circleId:string)=>Promise<object>} a.circleIdentityFor  per-circle signer (profile-seed derived)
 * @param {string} a.myRef               this member's ref (webid == chat pubKey in the basis binding)
 * @param {Function} a.callSkill         the waist (roster lookups for the key↔ref binding)
 * @param {(circleId:string)=>({put:Function, delete:Function}|null)} a.storeFor  the circle's CircleItemStore
 * @param {Function} [a.verifyBinding]   override the roster binding verifier (tests)
 * @param {object} [a.own]   THE PERSON'S OWN SCOPE (the own-devices store): rides the same lane between the person's
 *   own devices only — one lane per SELF the device holds (the default's and each persona's). `isOwn(scope)` says
 *   whether a scope is one of them (or `scope` names the only one); `signer(scope)` is this device's delegation key for
 *   that lane's self (`{identity, ref}`, or null when the device is not enrolled — then nothing is sent);
 *   `verifyBinding` is that self's device-set binding (never a roster: there is none); `seal()` is the person's
 *   seal-to-self strategy (null → nothing is sent: own items never ride in the clear); `delegation(scope)` the record
 *   carried so a sibling verifies the chain without the registry. `belongs(scope, item)` says which lane an item of the
 *   one shared own store rides: a lane serves and applies only its own items (none of another self's).
 */
export function makeItemsRail({ eventLog, circleIdentityFor, myRef, callSkill, storeFor, verifyBinding = null, onItemApplied = null, own = null }) {
  const refIn = selfRefIn(myRef);   // in each circle, the self this device is there
  if (typeof circleIdentityFor !== 'function' || typeof storeFor !== 'function') return null;
  const isOwn = (circleId) => (typeof own?.isOwn === 'function' ? own.isOwn(circleId) === true : (Boolean(own?.scope) && circleId === own.scope));
  const rosterBinding = verifyBinding ?? rosterBindingVerifier(callSkill);
  const ownSigner = async (scope) => { try { return (await own?.signer?.(scope)) ?? null; } catch { return null; } };
  const ownBelongs = (scope, item) => { try { return typeof own?.belongs === 'function' ? own.belongs(scope, item) === true : true; } catch { return false; } };
  const ownSeal = () => { try { return own?.seal?.() ?? null; } catch { return null; } };
  const ownDelegation = (scope) => { try { const d = own?.delegation?.(scope); return d ? { delegation: d } : {}; } catch { return {}; } };
  /** An own item as it rides: sealed to the person, with the device's delegation for that lane; null when it cannot be sealed. */
  const ownSnapshotPayload = (scope, item) => {
    const strategy = ownSeal();
    if (!strategy || !item) return null;
    return { sealed: strategy.seal(JSON.stringify(item)), ...ownDelegation(scope) };
  };
  const base = makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => (isOwn(circleId) ? ownSigner(circleId) : { identity: await circleIdentityFor(circleId), ref: refIn(circleId) }),
    entryKind: ITEMS_LANE,
    declaredKinds: ITEMS_RAIL_KINDS,
    verifyBinding: (a) => (isOwn(a?.circleId) ? (own.verifyBinding?.(a) ?? false) : rosterBinding(a)),
  });

  /** The item a snapshot carries: in the clear on a circle's lane, sealed to the person on the own scope. */
  function itemOf(circleId, body) {
    if (!isOwn(circleId)) return body.payload?.item;
    const strategy = ownSeal();
    if (!strategy || typeof body.payload?.sealed !== 'string') return null;
    try { return JSON.parse(strategy.open(body.payload.sealed)); } catch { return null; }
  }

  /** Apply a VERIFIED item statement to the circle's materialised head. Idempotent: a re-delivered
   *  snapshot re-merges to the same result; a re-delivered remove re-deletes nothing. */
  /** The item types this node was handed a row of and does not hold — each said once. */
  const notHeldTypes = new Set();
  /** Whether the folded roster (the projection every binding here reads) names this author an admin of the circle. */
  async function authorIsAdmin(circleId, ref) {
    if (typeof ref !== 'string' || !ref || typeof callSkill !== 'function') return false;
    try {
      const r = await callSkill('pinboard', 'listGroupMembers', { groupId: circleId });
      return (Array.isArray(r?.members) ? r.members : []).some((m) => m && (m.webid ?? m.addr ?? m.ref) === ref && m.role === 'admin');
    } catch { return false; }
  }
  const refusedAuthors = new Set();
  function refusedOnce(circleId, ref) {
    const key = `${circleId}\u0000${ref}`;
    if (refusedAuthors.has(key)) return;
    refusedAuthors.add(key);
    console.warn(`[items-lane] refused an announcement in ${circleId}: its author ${String(ref).slice(0, 12)}… is not an admin there`);
  }

  async function applyToHead(circleId, body) {
    const store = storeFor(circleId);
    if (!store) return;
    if (body.kind === 'snapshot') {
      const item = itemOf(circleId, body);
      if (!item || typeof item.id !== 'string' || !item.id) return;
      // on an own lane, only that lane's self's items (one lane never writes another self's into the shared own store)
      if (isOwn(circleId) && !ownBelongs(circleId, item)) return;
      // A roster row never lands through this lane: its addresses are proven facts patched in place,
      // and a peer's snapshot of "the person's row" is that peer's view, not this device's — nor does the circle's
      // rules head, which its own lane carries past an admin check. Refused here whatever served it (`rosterTrail.js`).
      if (isLaneCarriedItem(item)) return;
      // An ANNOUNCEMENT is the store door's, but an admin's word: one whose author the folded roster does not name an
      // admin is refused here, on the receiving device — the writer's own admin check binds only the writer's app.
      if (item.type === 'announcement' && !(await authorIsAdmin(circleId, body.payload?.authorRef))) {
        refusedOnce(circleId, body.payload?.authorRef);
        return;
      }
      // sync:false — an ingest never re-publishes (the echo loop); origin:true — the causal merge keeps
      // the writer's clock and runs the claim fold, exactly like the legacy mirror's inbound path.
      // whether this device held the row before: a snapshot that is an UPDATE (a claim, an edit) is not a new arrival.
      // A read then a put: two snapshots of one new row landing in the same tick may both read 'new' (one extra
      // announcement at most, never a missed one).
      let existed = false;
      try { existed = !!(await store.get?.(item.id)); } catch { existed = false; }
      try { await store.put(item, { sync: false, origin: true }); }
      catch (err) {
        // a type this node does not hold (an extension it does not run): the row is not held, the statement stays on
        // the log — the head picks it up the day the type is installed here (a rebuild re-applies what the log holds).
        // Said once per type, never per row.
        if (/unknown type/.test(String(err?.message ?? err))) {
          if (!notHeldTypes.has(item.type)) { notHeldTypes.add(item.type); console.warn(`[lane] ${circleId}: a "${item.type}" row is not held here (no such type on this node); kept on the log`); }
          return;
        }
        throw err;
      }
      // A snapshot that LANDED (verified, merged) — the seam for anything that indexes what the store holds
      // (the noticeboard bridge into pinboard's index). Best-effort: an indexer must never fail the merge.
      if (typeof onItemApplied === 'function') { try { await onItemApplied(circleId, item, { fresh: !existed }); } catch { /* indexed later by catch-up */ } }
    } else if (body.kind === 'remove') {
      const id = body.payload?.id ?? body.subject;
      if (typeof id === 'string' && id) await store.delete(id, { sync: false });
    }
  }

  /**
   * The catch-up serve set: the stored statements PLUS a signed snapshot for every live task head no stored
   * statement covers. Lane entries age out after their retention window while the store row lives on — so a
   * device that was away longer than the window would otherwise never receive the older heads. The extra
   * snapshots are SIGN-ONLY (chained like an append but never persisted here): the requester's ingest lands
   * them on ITS log and merges the head; this device's log is not churned by serving.
   */
  async function catchUpStatements(circleId) {
    const stored = base.storedStatements(circleId);
    const store = storeFor(circleId);
    if (!store || typeof store.list !== 'function') return stored;
    const covered = new Set();
    for (const s of stored) {
      const id = s?.body?.kind === 'snapshot' ? (s.body.payload?.item?.id ?? s.body.subject) : s?.body?.payload?.id ?? s?.body?.subject;
      if (typeof id === 'string' && id) covered.add(id);
    }
    let rows = [];
    try { rows = (await store.list()) ?? []; } catch { return stored; }
    const uncovered = rows.filter((it) => it && typeof it.id === 'string' && !covered.has(it.id) && !isLaneCarriedItem(it)
      && (!isOwn(circleId) || ownBelongs(circleId, it)));
    if (uncovered.length === 0) return stored;
    let resolved = null;
    let ref = refIn(circleId);
    try {
      if (isOwn(circleId)) { const s = await ownSigner(circleId); resolved = s?.identity ?? null; ref = s?.ref ?? null; }
      else resolved = await circleIdentityFor(circleId);
    } catch { return stored; }
    if (!resolved?.pubKey || typeof resolved.sign !== 'function') return stored;
    const bodies = stored.map((s) => s.body);
    const synthesized = [];
    for (const item of uncovered) {
      const parent = authorHead(bodies, resolved.pubKey);
      const deps = frontier(bodies).filter((h) => h !== parent);
      // the own scope serves what it sends: sealed to the person, or not at all
      const carried = isOwn(circleId) ? ownSnapshotPayload(circleId, item) : { item };
      if (!carried) return stored;
      const statement = signSpine(resolved, {
        kind: 'snapshot', circleId, subject: item.id,
        payload: { ...carried, authorRef: ref }, parent, deps,
      });
      bodies.push(statement.body);   // chain the next synthesized statement after this one
      synthesized.push(statement);
    }
    return [...stored, ...synthesized];
  }

  /**
   * Re-apply every statement this device ALREADY HOLDS for a circle to that circle's head.
   *
   * `storeFor` peeks and never builds (see the realAgent comment where this rail is composed): a
   * statement that arrives for a circle whose store is not open yet PARKS on the log, and the head
   * is supposed to converge "when the circle opens and catch-up runs". It did not. `applyToHead`
   * returned silently on the missing store, nothing re-applied the parked statement, and catch-up
   * could not heal it either — catch-up re-delivers statements the rail does not have, and the rail
   * HAD this one. Permanent loss, deterministic, in the window right after someone joins (F-016).
   *
   * This is the convergence that was described and never wired. It belongs here rather than in a
   * caller because the rail is what knows which statements it holds — and it costs nothing when a
   * head is already current: a re-applied snapshot re-merges to the same result, and a re-applied
   * remove re-deletes nothing (the same idempotence `ingest` already relies on).
   *
   * @returns {Promise<number>} statements applied (0 when the store still is not there)
   */
  async function rebuildHead(circleId) {
    if (!storeFor(circleId)) return 0;
    let bodies = [];
    try { ({ bodies = [] } = await base.readVerifiedBodies(circleId)); } catch { return 0; }
    let applied = 0;
    for (const body of bodies) {
      try { await applyToHead(circleId, body); applied += 1; } catch { /* one bad body must not stop the rest */ }
    }
    return applied;
  }

  return {
    ...base,
    /** The one write path; on the own scope the item is sealed to the person (or nothing is written to the lane). */
    async append(circleId, opts = {}) {
      if (!isOwn(circleId)) return base.append(circleId, opts);
      if (opts.kind === 'snapshot') {
        const payload = ownSnapshotPayload(circleId, opts.payload?.item);
        if (!payload) return null;
        return base.append(circleId, { ...opts, payload });
      }
      if (!ownSeal()) return null;
      return base.append(circleId, { ...opts, payload: { ...(opts.payload ?? {}), ...ownDelegation(circleId) } });
    },
    catchUpStatements,
    rebuildHead,
    /** The full gate (signature + declared kind + key↔ref binding), then the head apply. */
    async ingest(circleId, statement) {
      const res = await base.ingest(circleId, statement);
      // a statement this log already holds was applied when it first landed: applying it again would put back what a
      // later statement removed (a sibling re-carrying an old snapshot after the delete)
      if (res?.ok && !res.existed) {
        try { await applyToHead(circleId, statement.body); }
        catch { /* the entry landed; the head converges on the next snapshot/catch-up */ }
      }
      return res;
    },
  };
}

/**
 * The write-side emitter: append the signed statement to the local log, then hand it to the fan
 * (best-effort — the local write never blocks on delivery). The local STORE write already happened
 * (the emitter is fed by the store's publish hook), so there is no head apply here.
 */
export function makeItemsEmitter({ rail, fan = null }) {
  if (!rail) return null;
  async function emit(circleId, kind, subject, payload) {
    const res = await rail.append(circleId, { kind, subject, payload });
    if (!res) return null;
    if (typeof fan === 'function') {
      // Best-effort stays best-effort — the local write never blocks on delivery — but a refusal is
      // REPORTED, never swallowed. A fan that fails silently is indistinguishable from one that
      // delivered, which is exactly how a lost statement cost a bisect to find (2026-08-20).
      try { fan(circleId, res.statement); }
      catch (err) {
        console.warn(`[items-lane] fan threw for ${circleId} ${kind}(${String(subject).slice(0, 24)}):`, err?.message ?? err);
      }
    }
    return res.statement;
  }
  return {
    snapshot: (circleId, item) => emit(circleId, 'snapshot', item?.id, { item }),
    remove:   (circleId, id)   => emit(circleId, 'remove', id, { id }),
  };
}

/**
 * The publish valve (mirror-shaped, so `wireStoreMirror` wraps it unchanged). The unsigned mirror carry
 * is DELETED: with a lane emitter (a device log was composed — every production shell) everything
 * publishes as a signed lane statement; without one there is NO peer fan at all — content convergence
 * between devices requires the signed lane, and a composition that wants it composes a device log
 * (as every converted test does, through a real join).
 *
 * `requireSigned` closes the downgrade window LOUDLY. The emitter is handed over AFTER boot, while this
 * valve is wired when a circle opens — a write in between must fail visibly on a composition that asked
 * for signed lanes, never silently not-fan.
 */
export function routeItemsMirror({ circleId, emitter, requireSigned = false } = {}) {
  const noDowngrade = () => {
    if (requireSigned && !emitter) {
      throw new Error(
        `routeItemsMirror(${circleId}): a signed lane was required but no emitter is wired yet — `
        + 'refusing to publish (the unsigned mirror carry is deleted)',
      );
    }
  };
  return {
    publishItem(item) {
      noDowngrade();
      // a roster-trail row and a rules head travel by their own lanes' carriers, never as a lane snapshot (rosterTrail.js)
      if (isLaneCarriedItem(item)) return undefined;
      if (emitter && item) return emitter.snapshot(circleId, item);
      return undefined;   // no lane → no fan (the write stays local)
    },
    publishItemRemoved(id) {
      noDowngrade();
      if (emitter) return emitter.remove(circleId, id);
      return undefined;
    },
  };
}

/** Peer handler for `circle-items-broadcast` → the rail's full ingest gate + the head apply. */
/** `onLanded(circleId, statement, fromPeerAddr)` fires once per NEW statement — the sibling carry's seam. */
export function makeItemsPeerHandler({ rail, onChange = null, onLanded = null, holds = null, onPassed = null } = {}) {
  if (!rail) throw new Error('makeItemsPeerHandler: a items rail is required');
  return async function onCircleTask(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== ITEMS_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    // This device's selection (sync-policy §11) — the same three answers as the chat handler: land · verify
    // and pass on (hold nothing, still carry) · refuse (the kring is off here).
    const h = typeof holds === 'function' ? holds(circleId) : true;
    if (h === null) return;
    try {
      if (h === false) {
        const v = typeof rail.verify === 'function' ? await rail.verify(circleId, statement) : { ok: false };
        if (v?.ok && typeof onPassed === 'function') { try { await onPassed(circleId, statement, fromPeerAddr); } catch { /* best-effort */ } }
        return;
      }
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
      if (res?.ok && !res.existed && typeof onLanded === 'function') {
        try { await onLanded(circleId, statement, fromPeerAddr); } catch { /* side effects are best-effort */ }
      }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
