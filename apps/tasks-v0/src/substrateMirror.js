/**
 * Tasks substrate-mirror — cross-device task fan-out (Phase 52.9.3,
 * 2026-05-14, Tasks V2 ninth slice).
 *
 * OBJ-2 S2: now a THIN wrapper over the shared generic `wireItemMirror`
 * (`@onderling/notify-envelope`), which household also uses. Tasks-specific bits:
 * the envelope `kind` ('task'), the per-circle URI namespace, the full task draft
 * (dependencies / requiredSkills / approval / containedBy / scheduling / …),
 * and an action inference that also reads the review-log (submit/approve/reject).
 *
 * Behaviour is unchanged from the prior hand-rolled copy: `addTask` fan-out plus
 * mutation fan-out (claim/complete/submit/approve/reject/reassign via the full
 * task state on every `publishTask`), hard-delete via `publishTaskRemoved`, and
 * the Q-D stale-peer auto-heal — all of which live in the shared core now.
 *
 * The receive path runs the Q-D 3-way Lamport version compare via
 * `pseudoPod.writeFromPeer` (inside notify-envelope) before the mirror applies;
 * `'stale-peer'` events drive the auto-heal republish.
 *
 * @param {object} args
 * @param {import('@onderling/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope   — shared per-bundle instance.
 * @param {object} args.pseudoPod        — shared per-bundle instance.
 * @param {string} args.circleId           — circle identifier (URI namespace).
 * @param {Array<{pubKey: string}>} [args.peers]
 * @param {string} [args.selfPubKey]     — local agent address; filtered out (self).
 * @returns {Promise<{
 *   addPeer:(pubKey:string)=>Promise<void>, removePeer:(pubKey:string)=>void,
 *   stop:()=>Promise<void>, listPeers:()=>string[], getPeers:()=>string[],
 *   urlFor:(taskId:string)=>string,
 *   publishTask:(task:object, opts?:object)=>Promise<void>,
 *   publishTaskRemoved:(originalId:string, opts?:object)=>Promise<void>,
 * }>}
 */
import { wireItemMirror } from '@onderling/notify-envelope';

/** Reconstruct an `addItems` draft from a synced task payload (full task shape). */
function taskDraft(payload, fromPubKey) {
  return {
    type:           payload.type ?? 'task',
    ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
    text:           payload.text ?? '(synced)',
    ...(payload.notes ? { notes: payload.notes } : {}),
    ...(payload.dependencies   ? { dependencies:   payload.dependencies }   : {}),
    ...(payload.requiredSkills ? { requiredSkills: payload.requiredSkills } : {}),
    ...(payload.dueAt !== undefined ? { dueAt: payload.dueAt } : {}),
    ...(payload.visibility ? { visibility: payload.visibility } : {}),
    ...(payload.definitionOfDone ? { definitionOfDone: payload.definitionOfDone } : {}),
    ...(payload.approval ? { approval: payload.approval } : {}),
    // The subtask tree edge: the CONTAINMENT back-ref on the child — so a synced subtask keeps its parent
    // link on the peer.
    ...(Array.isArray(payload.containedBy) && payload.containedBy.length ? { containedBy: payload.containedBy } : {}),
    ...(payload.scheduledAt     !== undefined ? { scheduledAt:     payload.scheduledAt }     : {}),
    ...(payload.estimateMinutes !== undefined ? { estimateMinutes: payload.estimateMinutes } : {}),
    ...(payload.embeds ? { embeds: payload.embeds } : {}),
    source: {
      synced:        true,
      syncedFromId:  payload.id,
      fromPubKey,
      ...(payload.source ?? {}),
    },
  };
}

/**
 * Infer the sync action for a task transition. Extends the shared default with
 * the review-log branch: submit/approve/reject mutate `reviewLog` rather than a
 * dedicated field, so a grown reviewLog's newest `decision` names the action.
 */
function taskInferAction(local, next) {
  const localLen = Array.isArray(local.reviewLog) ? local.reviewLog.length : 0;
  const nextLen  = Array.isArray(next.reviewLog)  ? next.reviewLog.length  : 0;
  if (nextLen > localLen) {
    const newest = next.reviewLog[nextLen - 1];
    if (newest?.decision === 'submit')  return 'submit';
    if (newest?.decision === 'reject')  return 'reject';
    if (newest?.decision === 'approve') return 'approve';
  }
  if (!local.completedAt && next.completedAt)        return 'complete';
  if (local.assignee && !next.assignee)              return 'revoke';
  if (!local.assignee && next.assignee)              return 'claim';
  if (local.assignee && next.assignee && local.assignee !== next.assignee) return 'reassign';
  return 'update';
}

export async function wireTasksSubstrateMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  circleId,
  peers = [],
  selfPubKey = null,
}) {
  const mirror = await wireItemMirror({
    itemStore,
    notifyEnvelope,
    pseudoPod,
    scopeId:     circleId,
    kind:        'task',
    uriPrefix:   (id) => `/tasks/circles/${id}/tasks/`,
    toDraft:     taskDraft,
    inferAction: taskInferAction,
    scopeField:  'circleId',
    peers,
    selfPubKey,
  });
  // Preserve tasks' vocabulary on the surface (publishTask / publishTaskRemoved).
  const { publish, publishRemoved, ...rest } = mirror;
  return { ...rest, publishTask: publish, publishTaskRemoved: publishRemoved };
}
