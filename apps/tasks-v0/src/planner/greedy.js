/**
 * greedy planner — Tasks.
 *
 * Pure function over (open assignments, busy spans, working-hours
 * windows, now). No I/O. Returns a sorted list of suggestions:
 *
 *   [{ taskId, slotStart, slotEnd, reason, fits: true | false }, …]
 *
 * Algorithm (greedy):
 *   1. Sort open tasks by `dueAt` ascending; tie-break by required-skill
 *      rarity (rare-skill tasks first), then by `addedAt` for stability.
 *   2. For each task, walk forward in 30-min steps from `now` within the
 *      member's `workingHours` until a slot of `estimateMinutes` (default
 *      60) fits without crossing `dueAt`.
 *   3. Tag the suggestion with a reason: `'overdue'`, `'last-chance'`,
 *      `'fits before deadline'`, `'no slot'` (couldn't fit).
 *
 * No backtracking. If a later task's only candidate slot is the one
 * just claimed by an earlier task, the later one becomes `'no slot'`
 * — honest about the limitation; the user reassigns or extends the
 * deadline.
 *
 * The planner is deliberately simple. A second app needing the same
 * shape would lift this into `@onderling/scheduler`; until then,
 * app-local.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — planner slot step + default estimate (scope:device, kind:internal).
const SLOT_STEP_MIN = param({ key: 'tasksV0.slotStepMin', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 });
// FLAG: possibly user-facing preference (default duration estimate) — migrated as INTERNAL per rubric.
const DEFAULT_ESTIMATE_MIN = param({ key: 'tasksV0.estimateMin', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} TaskInput
 * @property {string} taskId
 * @property {number} dueAt              — unix-ms (required)
 * @property {number} [estimateMinutes]  — defaults to 60
 * @property {string[]} [requiredSkills]  — used for tie-breaking
 * @property {number} [addedAt]          — for stable sort
 *
 * @typedef {object} BusySpan
 * @property {number} start              — unix-ms
 * @property {number} end                — unix-ms (exclusive)
 *
 * @typedef {object} WorkingHoursWindow
 * @property {string} day                — 'mon' | 'tue' | ... | 'sun'
 * @property {string} start              — 'HH:MM' (24h, member-local)
 * @property {string} end                — 'HH:MM' (24h)
 *
 * @typedef {object} Suggestion
 * @property {string} taskId
 * @property {number} slotStart
 * @property {number} slotEnd
 * @property {'overdue'|'last-chance'|'fits before deadline'|'no slot'} reason
 * @property {boolean} fits
 */

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * @param {object} args
 * @param {TaskInput[]} args.tasks
 * @param {BusySpan[]} args.busySpans
 * @param {WorkingHoursWindow[]} args.workingHours
 * @param {number} [args.now=Date.now()]
 * @param {number} [args.lookaheadDays=7]
 * @returns {Suggestion[]}
 */
export function suggestSchedule({
  tasks,
  busySpans,
  workingHours,
  now = Date.now(),
  lookaheadDays = 7,
}) {
  if (!Array.isArray(tasks))         throw new TypeError('tasks[] required');
  if (!Array.isArray(busySpans))     throw new TypeError('busySpans[] required');
  if (!Array.isArray(workingHours))  throw new TypeError('workingHours[] required');

  const sorted = _sortTasks(tasks);
  const horizon = now + lookaheadDays * MS_PER_DAY;

  // Mutable busy list — accepted suggestions get added so subsequent
  // tasks don't double-book the same slot.
  const busy = [...busySpans];
  const out = [];

  for (const t of sorted) {
    const estimate = (Number.isFinite(t.estimateMinutes) ? t.estimateMinutes : DEFAULT_ESTIMATE_MIN) * MS_PER_MIN;
    const dueAt = t.dueAt;
    const overdueAtStart = dueAt < now;
    // Walk window: start at NOW, end at min(dueAt, horizon).
    const windowEnd = Math.min(dueAt, horizon);
    const fitStart = _findFreeSlot({
      from: now,
      to:   windowEnd,
      estimate,
      busy,
      workingHours,
    });

    if (fitStart === null) {
      out.push({
        taskId:    t.taskId,
        slotStart: now,
        slotEnd:   now + estimate,
        reason:    overdueAtStart ? 'overdue' : 'no slot',
        fits:      false,
      });
      continue;
    }

    // Tag a reason chip based on slack.
    const slackMs = dueAt - (fitStart + estimate);
    let reason = 'fits before deadline';
    if (overdueAtStart) reason = 'overdue';
    else if (slackMs < estimate) reason = 'last-chance';

    const slot = { start: fitStart, end: fitStart + estimate };
    busy.push(slot);                  // future tasks see it as occupied
    out.push({
      taskId:    t.taskId,
      slotStart: slot.start,
      slotEnd:   slot.end,
      reason,
      fits:      true,
    });
  }

  return out;
}

// ── Internals ────────────────────────────────────────────────────────────────

function _sortTasks(tasks) {
  const skillCount = new Map();
  for (const t of tasks) {
    for (const s of t.requiredSkills ?? []) {
      skillCount.set(s, (skillCount.get(s) ?? 0) + 1);
    }
  }
  const rarity = (t) => {
    if (!Array.isArray(t.requiredSkills) || t.requiredSkills.length === 0) return Infinity;
    return Math.min(...t.requiredSkills.map((s) => skillCount.get(s) ?? Infinity));
  };
  return [...tasks].sort((a, b) => {
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    const ra = rarity(a), rb = rarity(b);
    if (ra !== rb) return ra - rb;            // rarer skills first
    return (a.addedAt ?? 0) - (b.addedAt ?? 0);
  });
}

/**
 * Walk forward in SLOT_STEP_MIN steps until we find a contiguous slot
 * of `estimate` ms inside the working-hours window AND not overlapping
 * any busy span. Returns the unix-ms start, or null.
 */
function _findFreeSlot({ from, to, estimate, busy, workingHours }) {
  if (estimate <= 0) return null;
  let cursor = _alignToStep(from);
  const stepMs = SLOT_STEP_MIN * MS_PER_MIN;
  while (cursor + estimate <= to) {
    const slotEnd = cursor + estimate;
    if (_inWorkingHours(cursor, workingHours) &&
        _inWorkingHours(slotEnd - 1, workingHours) &&
        !_overlapsBusy(cursor, slotEnd, busy)) {
      return cursor;
    }
    cursor += stepMs;
  }
  return null;
}

function _alignToStep(t) {
  const stepMs = SLOT_STEP_MIN * MS_PER_MIN;
  return Math.ceil(t / stepMs) * stepMs;
}

function _overlapsBusy(start, end, busy) {
  for (const b of busy) {
    if (start < b.end && end > b.start) return true;
  }
  return false;
}

function _inWorkingHours(t, workingHours) {
  if (!workingHours || workingHours.length === 0) return true;       // no constraints → always ok
  const d = new Date(t);
  const day = VALID_DAYS[(d.getDay() + 6) % 7];
  const minOfDay = d.getHours() * 60 + d.getMinutes();
  for (const w of workingHours) {
    if (w.day !== day) continue;
    const start = _hhmmToMin(w.start);
    const end   = _hhmmToMin(w.end);
    if (start === null || end === null) continue;
    if (minOfDay >= start && minOfDay < end) return true;
  }
  return false;
}

function _hhmmToMin(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h  = Number(m[1]);
  const mn = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mn) || h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

export { SLOT_STEP_MIN, DEFAULT_ESTIMATE_MIN };
