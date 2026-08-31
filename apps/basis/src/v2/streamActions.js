/**
 * basis v2 — Stream per-row action buttons.
 *
 * The Stream shows action buttons under each Stream row depending on the
 * event type: "Ik help" / "Negeer" on a question, "Ik doe ze" on a
 * household chore.  This module decides which buttons to render for a
 * given Stream row + describes the pinned compose's context.  Pure;
 * the renderer wires the resulting `{id, label, action, payload}` to
 * dispatch.
 *
 * Why split this from the existing `buildCircleStream`?  The row
 * projection (2.1) keeps the audit-trail shape; this is the action
 * layer that lives on TOP of the row.  Keeps both layers pure +
 * testable.
 */

import { translatorOr } from '../locales/translatorOr.js';

const KIND_CHIPS = {
  ask:         ['help', 'ignore'],
  lend:        ['offer', 'ignore'],
  borrow:      ['offer', 'ignore'],
  offer:       ['take', 'ignore'],
  chore:       ['claim', 'snooze'],
  reminder:    ['done', 'snooze'],
};

const ACTION_DEFS = {
  help:    { label: 'circle.streamAction.help'    },
  offer:   { label: 'circle.streamAction.offer'   },
  take:    { label: 'circle.streamAction.take'    },
  claim:   { label: 'circle.streamAction.claim'   },
  done:    { label: 'circle.streamAction.done'    },
  snooze:  { label: 'circle.streamAction.snooze'  },
  ignore:  { label: 'circle.streamAction.ignore'  },
  // "entrust" / toevertrouwen — open the mandate picker for a task-like row. Not
  // a KIND_CHIPS entry: it is appended by `actionsForStreamRow` only for the
  // task's owner (creator/admin), so it never shows on the generic chip row.
  mandate: { label: 'circle.streamAction.mandate' },
};

/**
 * The task-like row kinds that can carry a mandate (a task-scoped, temporary,
 * brokered grant). A mandate is bounded authority the task OWNER entrusts for
 * one task; the `attachTaskGrant` op enforces the real creator/admin gate — the
 * owner-only VISIBILITY here is a UX affordance, not the security boundary.
 *
 * Exported so the row PROJECTION (`buildCircleStream`) can stamp first-class
 * task provenance on the same kinds — one source of truth for "is this a
 * task-like row" (invariant #3).
 */
export const MANDATE_KINDS = new Set(['task', 'chore', 'reminder']);

/**
 * First-class task provenance for a task/chore/reminder EVENT — the `taskId`
 * (the item ref) + `addedBy` (the creator). This is the SINGLE extractor the
 * projection uses to stamp `{ taskId, addedBy }` on a row, so the owner check
 * downstream is deterministic rather than rummaging through payload shapes.
 *
 * Returns null when the event is not a task-like kind (the row then carries no
 * provenance — backwards-compatible; the action just hides).
 *
 * @param {object} event  a LoggedEvent (`{ type?, kind?, payload? }`)
 * @returns {{ taskId: (string|null), addedBy: (string|null) } | null}
 */
export function taskRowProvenance(event) {
  const ev = event && typeof event === 'object' ? event : {};
  const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
  const cands = [p.kind, ev.type, ev.kind];
  const isTaskLike = cands.some((c) => typeof c === 'string' && MANDATE_KINDS.has(c.toLowerCase()));
  if (!isTaskLike) return null;
  const taskId  = p.ref ?? p.taskId ?? p.id ?? ev.itemRef?.id ?? null;
  const addedBy = p.addedBy ?? p.master ?? p.creator ?? p.author ?? null;
  return { taskId, addedBy };
}

/**
 * The task creator for a stream row. Prefers the FIRST-CLASS `row.addedBy`
 * stamped by the projection (`buildCircleStream` → `taskRowProvenance`), so the
 * owner check is deterministic for a mirrored-in task regardless of admin
 * status. Falls back to reading the event payload for rows built WITHOUT
 * provenance (backwards-compatible); when neither is present the caller's
 * viewer signals (`isOwn` / `isAdmin`) still decide visibility.
 */
function rowTaskCreator(row) {
  if (row && typeof row.addedBy === 'string' && row.addedBy) return row.addedBy;
  const ev = row && row.event && typeof row.event === 'object' ? row.event : {};
  const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
  return p.addedBy ?? p.master ?? p.creator ?? p.author ?? null;
}

/**
 * Owner-only visibility for the mandate action. Shows when the viewer is a
 * circle admin, OR authored this row (`isOwn`, e.g. the local sender), OR their
 * WebID matches the row's recorded creator. When none of these can be affirmed
 * (no viewer threaded AND no creator on the row) the action is HIDDEN — we
 * prefer owner-only visibility; the handler gate still rejects any non-owner
 * that reaches the op by another path.
 */
function viewerMayMandate(row, { viewerWebid = null, isAdmin = false, isOwn = false } = {}) {
  if (isAdmin) return true;
  if (isOwn) return true;
  const creator = rowTaskCreator(row);
  return !!(viewerWebid && creator && viewerWebid === creator);
}

/**
 * Pick the action buttons for a Stream row.
 *
 * @param {object} row  product of `buildCircleStream`: `{type, event:
 *                      {payload: {kind?, text?, …}}}` etc.
 * @param {object} [viewer]  the viewer's identity signals, used ONLY to decide
 *   whether the task owner's "entrust" (mandate) action is offered on a
 *   task-like row. Omitted → no mandate action (backwards-compatible default).
 * @param {string|null} [viewer.viewerWebid]  the viewer's WebID
 * @param {boolean}     [viewer.isAdmin]      viewer is a circle admin
 * @param {boolean}     [viewer.isOwn]        the viewer authored this row
 * @returns {Array<{id:string, label:string, action:string, payload:object}>}
 */
export function actionsForStreamRow(row, viewer = {}) {
  if (!row || typeof row !== 'object') return [];
  const ev = row.event && typeof row.event === 'object' ? row.event : {};
  const payload = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
  const kindKey = pickKindKey(row, ev, payload);
  const chips = KIND_CHIPS[kindKey] ?? [];
  const ref = payload.ref ?? null;
  const rowId = row.id ?? null;
  const out = chips.map((action) => ({
    id:      `${row.id ?? ev.id ?? 'row'}-${action}`,
    action,
    label:   ACTION_DEFS[action]?.label ?? `circle.streamAction.${action}`,
    payload: { rowId, circleId: row.circleId ?? null, kind: kindKey, ref },
  }));

  // "Entrust" (mandate) — appended for a task-like row, owner-only. Carries the
  // taskId (the row's item ref) so the picker can dispatch `attachTaskGrant`.
  // The mandate kind is resolved independently of KIND_CHIPS so a bare `task`
  // row (which has no chips) still offers it to its owner.
  const mandateKind = pickMandateKind(row, ev, payload);
  if (mandateKind && viewerMayMandate(row, viewer)) {
    // Prefer the first-class `row.taskId` stamped by the projection; fall back to
    // the payload ref for rows built without provenance.
    const taskId = (typeof row.taskId === 'string' && row.taskId) ? row.taskId : ref;
    out.push({
      id:      `${row.id ?? ev.id ?? 'row'}-mandate`,
      action:  'mandate',
      label:   ACTION_DEFS.mandate.label,
      payload: { rowId, circleId: row.circleId ?? null, kind: mandateKind, ref, taskId },
    });
  }
  return out;
}

function pickKindKey(row, ev, payload) {
  const cands = [payload.kind, ev.type, row.type, ev.kind];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim() && KIND_CHIPS[c.toLowerCase()]) {
      return c.toLowerCase();
    }
  }
  return null;
}

/** Resolve a task-like kind for the mandate action (independent of KIND_CHIPS). */
function pickMandateKind(row, ev, payload) {
  const cands = [payload.kind, ev.type, row.type, ev.kind];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim() && MANDATE_KINDS.has(c.toLowerCase())) {
      return c.toLowerCase();
    }
  }
  return null;
}

/**
 * Build the pinned-compose context shown at the bottom of the Stream.
 * The compose follows the focused row's circle context — the placeholder
 * + the post target are derived from whichever row is in focus.
 *
 * @param {object} args
 * @param {object|null} args.focusedRow  the Stream row currently focused (or null = no focus)
 * @param {function} args.t              host translator
 * @returns {{
 *   targetCircleId: string|null,
 *   targetCircleName: string|null,
 *   placeholder: string,
 *   replyToId: string|null,
 * }}
 */
export function buildStreamComposeContext({ focusedRow, t } = {}) {
  const tr = translatorOr(t, 'streamActions.js');
  if (!focusedRow || typeof focusedRow !== 'object') {
    return {
      targetCircleId:   null,
      targetCircleName: null,
      placeholder:      tr('circle.stream.compose_placeholder_default'),
      replyToId:        null,
    };
  }
  const cid = typeof focusedRow.circleId === 'string' ? focusedRow.circleId : null;
  const cName = typeof focusedRow.circleName === 'string' ? focusedRow.circleName : null;
  return {
    targetCircleId:   cid,
    targetCircleName: cName,
    placeholder: cName
      ? tr('circle.stream.compose_placeholder_targeted', { circle: cName })
      : tr('circle.stream.compose_placeholder_default'),
    replyToId: focusedRow.id ?? null,
  };
}
