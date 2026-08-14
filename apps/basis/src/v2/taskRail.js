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
 * hook routes task types here and everything else to the legacy mirror — see `routeTaskMirror`.
 */
import { signSpine, authorHead, frontier } from '@onderling/core';
import { makeCircleEntryRail } from './circleEntryRail.js';
import { entryKindRegistryFromManifests } from '@onderling/item-store';
import { taskManifest, TASK_LANE } from './taskManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';

/** The statement kinds the task lane carries — DERIVED from the manifest's declared appends. */
export const TASK_RAIL_KINDS = entryKindRegistryFromManifests(taskManifest).kindsFor(TASK_LANE);

/** The item TYPES that ride the lane instead of the legacy mirror. Tasks came first (the claim cluster
 *  needs the writer-computed snapshot); the mirror-cargo inventory then moved the four household LIST
 *  types and the generic `note` over — same mechanics (full-item snapshot + the store's causal merge; no
 *  claim cluster involved). `contact` closed the set: the held question ("does an identity-adjacent type
 *  belong on a signed lane?") dissolved on inspection — the contact ITEM is a plain name record (the
 *  register-a-name op writes it), while the actual identity data (the ContactBook MemberMap, the roster)
 *  never was store cargo on any carry. With every store type on the lane, the legacy mirror carries
 *  nothing — its cargo plumbing can retire. */
export const TASK_LANE_TYPES = Object.freeze(new Set([
  'task', 'shopping', 'errand', 'repair', 'schedule', 'note', 'contact',
]));

/** The wire subtypes for the task lane's fan + catch-up (the governance/membership pairs' sibling). */
export const TASK_BROADCAST = 'kring-task-broadcast';
export const TASK_CATCHUP_SUBTYPES = Object.freeze({
  request: 'kring-task-catchup-request',
  batch:   'kring-task-catchup-batch',
  offer:   'kring-task-catchup-offer',
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
export function makeTaskRail({ eventLog, circleIdentityFor, myRef, callSkill, storeFor, verifyBinding = null }) {
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
    const uncovered = rows.filter((it) => it && TASK_LANE_TYPES.has(it.type) && typeof it.id === 'string' && !covered.has(it.id));
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

  return {
    ...base,
    catchUpStatements,
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
      try { fan(circleId, res.statement); } catch { /* fan is best-effort — catch-up reconciles */ }
    }
    return res.statement;
  }
  return {
    snapshot: (circleId, item) => emit(circleId, 'snapshot', item?.id, { item }),
    remove:   (circleId, id)   => emit(circleId, 'remove', id, { id }),
  };
}

/**
 * The per-type valve (mirror-shaped, so `wireStoreMirror` wraps it unchanged): task-lane types publish as
 * signed lane snapshots; every other type keeps the legacy mirror carry. One path per type — the mirror
 * stops carrying task items the moment this is wired.
 */
export function routeTaskMirror({ circleId, mirror, emitter, laneTypes = TASK_LANE_TYPES } = {}) {
  return {
    publishItem(item) {
      if (emitter && item && laneTypes.has(item.type)) return emitter.snapshot(circleId, item);
      return mirror?.publishItem?.(item);
    },
    publishItemRemoved(id, removedItem) {
      // Routing needs the removed item's type; when the store couldn't supply it (row already gone) the
      // removal falls back to the legacy mirror — today's behaviour, and idempotent on every receiver.
      if (emitter && removedItem && laneTypes.has(removedItem.type)) return emitter.remove(circleId, id);
      return mirror?.publishItemRemoved?.(id);
    },
  };
}

/** Peer handler for `kring-task-broadcast` → the rail's full ingest gate + the head apply. */
export function makeTaskPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeTaskPeerHandler: a task rail is required');
  return async function onKringTask(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== TASK_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && typeof onChange === 'function') { try { onChange(circleId); } catch { /* best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
