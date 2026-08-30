/**
 * taskRail — task items ride THE RAIL (the content re-root, tasks first).
 *
 * The task lane is the first CONTENT lane: no authority fold — the truth about a task is its materialised
 * STORE ROW, and the lane's job is to carry each writer's row (a full-item snapshot, signed with the
 * per-circle key) to the circle's other devices, where it lands through the SAME causal merge every store
 * ingest uses (`put(..., {sync:false, origin:true})`: content LWW on the Lamport clock + the claim fold, so
 * the CAS guarantee and the writer-computed claim cluster — claimSeq, confirmation, `confirmedSig` — arrive
 * intact). The statement signature authenticates the CARRIER (whoever fanned it); the item's own authorship
 * facts (`updatedBy`, `confirmedSig`) travel inside the snapshot and are judged by the merge, so a
 * republished head remains as valid as a fresh write.
 *
 * This lane replaces the unsigned peer-mirror carry for task items (per-type one-path): the store's publish
 * hook routes every circle-content publish onto the lane — see `routeTaskMirror` (unsigned carry deleted).
 */
import { signSpine, authorHead, frontier } from '@onderling/core';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { taskManifest, TASK_LANE } from './taskManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';

/** The statement kinds the task lane carries — DERIVED from the manifest's declared appends. */
export const TASK_RAIL_KINDS = entryKindRegistryFromManifests(taskManifest).kindsFor(TASK_LANE);

/*
 * There is deliberately NO list of item types here. Whatever the circle's store holds rides this lane: the
 * store's registry already decided what may be written, and a second list at the valve could only disagree
 * with it — a type the registry accepted but the list did not know (an announcement, a calendar entry, the
 * next feature's rows) silently never reached a device that was away. The publish valve has no type gate
 * either (`routeTaskMirror`); catch-up below serves every row the store has a head for.
 */

/** The wire subtypes for the task lane's fan + catch-up (the governance/membership pairs' sibling). */
export const TASK_BROADCAST = 'circle-task-broadcast';
export const TASK_CATCHUP_SUBTYPES = Object.freeze({
  request: 'circle-task-catchup-request',
  batch:   'circle-task-catchup-batch',
  offer:   'circle-task-catchup-offer',
});

/**
 * Build the task rail over the device log. Mirrors `makeMembershipRail`, with one addition: a VERIFIED
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
 */
export function makeTaskRail({ eventLog, circleIdentityFor, myRef, callSkill, storeFor, verifyBinding = null, onItemApplied = null }) {
  if (typeof circleIdentityFor !== 'function' || typeof storeFor !== 'function') return null;
  const base = makeCircleEntryRail({
    eventLog,
    signerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: myRef }),
    entryKind: TASK_LANE,
    declaredKinds: TASK_RAIL_KINDS,
    verifyBinding: verifyBinding ?? rosterBindingVerifier(callSkill),
  });

  /** Apply a VERIFIED task statement to the circle's materialised head. Idempotent: a re-delivered
   *  snapshot re-merges to the same result; a re-delivered remove re-deletes nothing. */
  async function applyToHead(circleId, body) {
    const store = storeFor(circleId);
    if (!store) return;
    if (body.kind === 'snapshot') {
      const item = body.payload?.item;
      if (!item || typeof item.id !== 'string' || !item.id) return;
      // sync:false — an ingest never re-publishes (the echo loop); origin:true — the causal merge keeps
      // the writer's clock and runs the claim fold, exactly like the legacy mirror's inbound path.
      await store.put(item, { sync: false, origin: true });
      // A snapshot that LANDED (verified, merged) — the seam for anything that indexes what the store holds
      // (the noticeboard bridge into stoop's index). Best-effort: an indexer must never fail the merge.
      if (typeof onItemApplied === 'function') { try { await onItemApplied(circleId, item); } catch { /* indexed later by catch-up */ } }
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
      const id = s?.body?.kind === 'snapshot' ? s.body.payload?.item?.id : s?.body?.payload?.id ?? s?.body?.subject;
      if (typeof id === 'string' && id) covered.add(id);
    }
    let rows = [];
    try { rows = (await store.list()) ?? []; } catch { return stored; }
    const uncovered = rows.filter((it) => it && typeof it.id === 'string' && !covered.has(it.id));
    if (uncovered.length === 0) return stored;
    let resolved = null;
    try { resolved = await circleIdentityFor(circleId); } catch { return stored; }
    if (!resolved?.pubKey || typeof resolved.sign !== 'function') return stored;
    const bodies = stored.map((s) => s.body);
    const synthesized = [];
    for (const item of uncovered) {
      const parent = authorHead(bodies, resolved.pubKey);
      const deps = frontier(bodies).filter((h) => h !== parent);
      const statement = signSpine(resolved, {
        kind: 'snapshot', circleId, subject: item.id,
        payload: { item, authorRef: myRef }, parent, deps,
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
    catchUpStatements,
    rebuildHead,
    /** The full gate (signature + declared kind + key↔ref binding), then the head apply. */
    async ingest(circleId, statement) {
      const res = await base.ingest(circleId, statement);
      if (res?.ok) {
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
export function makeTaskEmitter({ rail, fan = null }) {
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
        console.warn(`[task-lane] fan threw for ${circleId} ${kind}(${String(subject).slice(0, 24)}):`, err?.message ?? err);
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
export function routeTaskMirror({ circleId, emitter, requireSigned = false } = {}) {
  const noDowngrade = () => {
    if (requireSigned && !emitter) {
      throw new Error(
        `routeTaskMirror(${circleId}): a signed lane was required but no emitter is wired yet — `
        + 'refusing to publish (the unsigned mirror carry is deleted)',
      );
    }
  };
  return {
    publishItem(item) {
      noDowngrade();
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

/** Peer handler for `circle-task-broadcast` → the rail's full ingest gate + the head apply. */
export function makeTaskPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeTaskPeerHandler: a task rail is required');
  return async function onCircleTask(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== TASK_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
