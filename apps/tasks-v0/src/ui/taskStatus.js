/**
 * taskStatus — pure helpers that compute UI state from a task item.
 *
 * Lifted 2026-05-10 from `apps/tasks-mobile/src/lib/taskStatus.js`
 * into `apps/tasks-v0/src/ui/` per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Both shells consume from here:
 *   - `apps/tasks-v0/web/app.js`                (vanilla-JS desktop)
 *   - `apps/tasks-mobile/src/screens/*.jsx`     (RN mobile)
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module. The whole file runs in the desktop's
 * vitest config (Node, no RN polyfills).
 *
 * The substrate gate (`enforceDependencies`) emits a `status`
 * field on listOpen output. The UI maps that into:
 *   - `kind`     — short label ('ready' | 'waiting' | 'blocked' | 'claimed' | 'submitted' | 'complete' | 'rejected')
 *   - `colorKey` — theme token to use for the pill ('info' | 'warning' | 'danger' | 'primary' | 'success' | 'textMuted')
 *   `depsBlocked` — true when the dependency gate would
 *                     reject `markComplete` / `approve` calls
 *   - `canClose`   — true when "Mark complete" / "Approve" is allowed
 *                     (NOT depsBlocked AND status is closable)
 *   - `openDepIds` — the substrate's listOpen carries `openDeps[]`
 *                     when there are unmet deps; we surface that as
 *                     short ids for the disabled-button tooltip.
 */

/** @typedef {'ready'|'waiting'|'blocked'|'claimed'|'pending-confirmation'|'provisional'|'submitted'|'complete'|'rejected'|'unknown'} StatusKind */

/**
 * @param {object} item   listOpen item from Tasks ItemStore
 * @returns {{
 *   kind: StatusKind,
 *   label: string,
 *   colorKey: 'info'|'warning'|'danger'|'primary'|'success'|'textMuted',
 *   depsBlocked: boolean,
 *   canClose: boolean,
 *   openDepIds: string[],
 *   isAssignee: (actor: string) => boolean,
 *   isMaster:   (actor: string) => boolean,
 * }}
 */
export function describeTaskStatus(item) {
  const kind = _normaliseKind(item?.status);

  // hard-deps gate. Two equivalent signals:
  //   - kind === 'waiting' / 'blocked' (legacy DAG-only listOpen
  //     output, still emitted when the task is unassigned).
  //   - item.openDeps[] (set by every list skill since 41.18).
  //     Carries the unmet dep IDs even when the lifecycle status
  //     wins over the DAG state (e.g. claimed-but-deps-open).
  const openDepArr   = Array.isArray(item?.openDeps) ? item.openDeps : [];
  const openDepIds   = openDepArr.map(_shortId);
  const hasOpenDeps  = openDepArr.length > 0;
  const depsBlocked  = hasOpenDeps || kind === 'waiting' || kind === 'blocked';

  // canClose — the substrate's DependenciesOpenError gate enforces
  // this server-side; the UI pre-disables Mark-complete / Approve
  // so the user doesn't tap into a guaranteed error.
  const canClose = !depsBlocked && (kind === 'claimed' || kind === 'submitted');

  return {
    kind,
    label: _LABELS[kind],
    colorKey: _COLOR[kind],
    depsBlocked,
    canClose,
    openDepIds,
    isAssignee: (actor) => typeof actor === 'string' && actor === item?.assignee,
    isMaster:   (actor) => typeof actor === 'string' &&
                            (actor === item?.master || actor === item?.addedBy),
  };
}

/**
 * "Add sub-task" → "Propose sub-task" gate, per.
 *
 * @param {object} item       parent item
 * @param {string} actor      caller's webid (or pubKey on mobile)
 */
export function shouldProposeSubtask(item, actor) {
  if (!item || typeof actor !== 'string') return false;
  if (item.status !== 'submitted') return false;
  return item.assignee && item.assignee !== actor;
}

/**
 * Force-complete UI gate — admin-only, with a mandatory reason.
 * Returns true when the "Force complete" button should render.
 *
 * @param {object} item
 * @param {string} actor      caller's webid (or pubKey on mobile)
 * @param {string} role       caller's role in the active circle
 */
export function shouldOfferForceComplete(item, actor, role) {
  if (!item) return false;
  if (role !== 'admin' && role !== 'coordinator') return false;
  const status = describeTaskStatus(item);
  return status.depsBlocked && status.kind !== 'complete';
}

// ── Internals ─────────────────────────────────────────────────────────────

function _normaliseKind(s) {
  if (typeof s !== 'string' || !s) return 'unknown';
  if (s === 'ready' || s === 'waiting' || s === 'blocked' ||
      s === 'claimed' || s === 'pending-confirmation' || s === 'provisional' ||
      s === 'submitted' || s === 'complete' ||
      s === 'rejected') return s;
  return 'unknown';
}

const _LABELS = {
  ready:     'ready',
  waiting:   'waiting',
  blocked:   'blocked',
  claimed:   'claimed',
  // A claim awaiting the master's confirmation (explicit-confirm) — "not yours yet".
  'pending-confirmation': 'awaiting confirmation',
  // An optimistic subtask spawned under a pending claim — committed on confirmation, discarded on loss.
  provisional: 'provisional',
  submitted: 'submitted',
  complete:  'complete',
  rejected:  'rejected',
  unknown:   '—',
};

const _COLOR = {
  ready:     'info',
  waiting:   'warning',
  blocked:   'danger',
  claimed:   'primary',
  'pending-confirmation': 'warning',
  provisional: 'textMuted',
  submitted: 'success',
  complete:  'textMuted',
  rejected:  'danger',
  unknown:   'textMuted',
};

function _shortId(id) {
  if (typeof id !== 'string') return '?';
  // urn:uuid:<...> → last 6 of the uuid; everything else → last 6 chars.
  const last = id.slice(-6);
  return last;
}

export const _internal = { _normaliseKind, _shortId, _LABELS, _COLOR };
