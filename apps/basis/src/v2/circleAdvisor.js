/**
 * basis v2 — circle Advisor (shared).
 *
 * A reactive, NO-LLM rules engine over the EventLog. It surfaces at most
 * ONE advice card per circle per month, and only when a circle shows signs
 * of strain: ≥3 "complaint" signals in the last 14 days AND rising activity
 * (a growth metric). Complaints include a member-pressed "too busy?" signal
 * (logged as a `too-busy` event) plus disputes. Pure: the host passes the
 * events (newest-first, e.g. `eventLog.query()`), the circle id, `now`, and
 * the `lastShownAt` it persisted; this decides whether to advise.
 */
import { eventCircleId } from './circleStream.js';
import { storageName } from './storageRegister.js';   // every storage name from the one register

/** The key under which a shell keeps when the advisor card was last shown for a circle. */
export const advisorShownKey = (circleId) => `${storageName('advisorShown')}${circleId}`;

/** Event types that count as a strain signal for a circle. */
export const COMPLAINT_TYPES = ['too-busy', 'dispute', 'complaint'];

const DAY = 24 * 60 * 60 * 1000;
export const ADVISOR_DEFAULTS = {
  minComplaints: 3,        // ≥3 in the window
  windowDays:    14,       // complaints lookback
  growthDays:    7,        // recent-vs-prior comparison half-window
  cooldownDays:  30,       // ≤1 advice card / month
};

/** A member's "too busy?" signal, ready to append to the EventLog. */
export function makeTooBusyEvent({ circleId, actor = null, now = Date.now() } = {}) {
  return {
    id:      `too-busy-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ts:      now,
    app:     'basis',
    type:    'too-busy',
    actor,
    payload: { circleId: circleId ?? null },
  };
}

function inCircle(e, circleId) {
  return circleId == null ? true : eventCircleId(e) === circleId;
}

/**
 * Decide whether to show an advice card for a circle right now.
 *
 * @param {object}   opts
 * @param {object[]} opts.events            LoggedEvent[]
 * @param {string}   [opts.circleId]        scope to this circle (null = all)
 * @param {number}   [opts.now=Date.now()]
 * @param {number|null} [opts.lastShownAt]  ms timestamp the host last showed advice (cooldown)
 * @param {object}   [opts.cfg]             override ADVISOR_DEFAULTS
 * @returns {null | { id, kind, circleId, complaints, recent, prior, growing, ts }}
 */
export function computeAdvice({ events = [], circleId = null, now = Date.now(), lastShownAt = null, cfg = {} } = {}) {
  const { minComplaints, windowDays, growthDays, cooldownDays } = { ...ADVISOR_DEFAULTS, ...cfg };

  // Cooldown: at most one card per `cooldownDays`.
  if (typeof lastShownAt === 'number' && now - lastShownAt < cooldownDays * DAY) return null;

  const scoped = (events || []).filter((e) => e && typeof e === 'object' && inCircle(e, circleId));

  const complaintCutoff = now - windowDays * DAY;
  const complaints = scoped.filter(
    (e) => COMPLAINT_TYPES.includes(e.type) && typeof e.ts === 'number' && e.ts >= complaintCutoff,
  ).length;

  // Growth: activity in the last `growthDays` vs the `growthDays` before that.
  const recentCutoff = now - growthDays * DAY;
  const priorCutoff = now - 2 * growthDays * DAY;
  let recent = 0;
  let prior = 0;
  for (const e of scoped) {
    if (typeof e.ts !== 'number') continue;
    if (e.ts >= recentCutoff) recent += 1;
    else if (e.ts >= priorCutoff) prior += 1;
  }
  const growing = recent > prior;

  if (complaints < minComplaints || !growing) return null;

  return {
    id:        `advice-${circleId ?? 'all'}-${now}`,
    kind:      'too-busy',
    circleId:  circleId ?? null,
    complaints,
    recent,
    prior,
    growing,
    ts:        now,
  };
}
