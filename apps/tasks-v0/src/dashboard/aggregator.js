/**
 * aggregator — Tasks cross-circle dashboard.
 *
 * Pure function over a list of circle bundles. For each one, projects:
 *   { circleId, name, kind, counts: {open, overdue, awaitingApproval, mine} }
 *
 * Counts:
 *   - open               — items with no `completedAt` (excl. subtask-request)
 *   - overdue            — open AND `dueAt < now`
 *   - awaitingApproval   — open AND status === 'submitted' AND approver === actor
 *                          (admin/coord see all submitted items)
 *   - mine               — open AND `assignee === actor`
 *
 * `aggregateCircles({circles, actor, now?})` returns the array sorted with
 * the busiest circles first. Pure — no I/O. Caller owns Circle lifecycle.
 */

// The dashboard counts WORK. An inbox item is a decision waiting on a person, not work, so the
// noun is excluded whole — the same level the calendar excludes at. This named one kind as a bare
// type and stopped matching when the negotiation moved to `{type: 'inbox-item', kind}`.
const INBOX_NOUN = 'inbox-item';

/**
 * @typedef {object} CircleSummary
 * @property {string} circleId
 * @property {string} name
 * @property {string} kind
 * @property {{open: number, overdue: number, awaitingApproval: number, mine: number}} counts
 */

/**
 * @param {object} args
 * @param {Array<{circle: object, openTasks: object[]}>} args.circles
 *   Pre-computed input — caller (the skill or test) reads each circle's
 *   open items via the circle's ItemStore and shapes them into this list.
 * @param {string} args.actor
 * @param {(actor: string, circle: object) => string | undefined} [args.roleOf]
 *   Optional role lookup per circle. Used to decide "all submitted vs
 *   only the ones I'd approve". Defaults to a no-op (member view).
 * @param {number} [args.now=Date.now()]
 * @returns {CircleSummary[]}
 */
export function aggregateCircles({ circles, actor, roleOf, now = Date.now() }) {
  if (!Array.isArray(circles)) throw new TypeError('circles[] required');
  if (typeof actor !== 'string' || !actor) throw new TypeError('actor required');

  const out = [];
  for (const entry of circles) {
    const circle = entry?.circle ?? {};
    const tasks = entry?.openTasks ?? [];
    const role  = typeof roleOf === 'function' ? roleOf(actor, circle) : 'member';

    let open = 0;
    let overdue = 0;
    let awaitingApproval = 0;
    let mine = 0;

    for (const t of tasks) {
      if (t?.type === INBOX_NOUN) continue;
      open++;
      if (Number.isFinite(t?.dueAt) && t.dueAt < now) overdue++;
      const isSubmitted = !!(t?.reviewLog ?? []).some((e) => e?.decision === 'submit') &&
        !(t?.reviewLog ?? []).some((e) => e?.decision === 'approve');
      if (isSubmitted) {
        if (role === 'admin' || role === 'coordinator') awaitingApproval++;
        else if ((t?.master ?? t?.addedBy) === actor) awaitingApproval++;
      }
      if (t?.assignee === actor) mine++;
    }

    out.push({
      circleId: circle.circleId ?? 'unknown',
      name:   circle.name ?? circle.circleId ?? 'unknown',
      kind:   circle.kind ?? 'household',
      counts: { open, overdue, awaitingApproval, mine },
    });
  }

  // Sort busiest first (open desc, then overdue desc, then name asc for stability).
  out.sort((a, b) => {
    if (b.counts.open    !== a.counts.open)    return b.counts.open    - a.counts.open;
    if (b.counts.overdue !== a.counts.overdue) return b.counts.overdue - a.counts.overdue;
    return String(a.name).localeCompare(String(b.name));
  });

  return out;
}
