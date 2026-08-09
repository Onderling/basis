/**
 * AvailabilityHints — Tasks.
 *
 * Per (member × ISO-week × half-day) opt-in chip:
 *   'open' | 'tight' | 'unavailable' | 'unknown'
 *
 * Half-days are 'mon-am', 'mon-pm', …, 'sun-pm' (14 cells per week).
 *
 * Pure data class — no I/O. Persistence is the wire helper's job.
 *
 * Privacy guards (per design § Q):
 *   - 'unknown' is the absent state. The data class returns 'unknown'
 *     for unset (member, week, half) tuples without distinguishing
 *     "never set" from "explicitly cleared".
 *   - Hints older than `STALE_AFTER_WEEKS` ISO weeks are filtered out
 *     of `getCircleAvailability` reads (visible "expired" state would
 *     leak the absence — drop them entirely).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const VALID_STATES = Object.freeze(['open', 'tight', 'unavailable']);
const VALID_HALVES = Object.freeze(['am', 'pm']);
const VALID_DAYS   = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
// Parameter register (#36) — availability hint staleness window in ISO weeks (scope:device, kind:internal).
const STALE_AFTER_WEEKS = param({ key: 'tasksV0.staleAfterWeeks', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

export class AvailabilityHints {
  /** @type {Map<string, Map<string, string>>} week → (cell → state) */
  #byWeek = new Map();

  /** Set the hint for a (week, day, half) cell. */
  set({ week, day, half, state }) {
    if (!isValidWeek(week)) throw new TypeError('week must be ISO YYYY-Www');
    if (!VALID_DAYS.includes(day)) throw new TypeError(`day must be one of ${VALID_DAYS.join('|')}`);
    if (!VALID_HALVES.includes(half)) throw new TypeError(`half must be one of ${VALID_HALVES.join('|')}`);
    if (!VALID_STATES.includes(state) && state !== 'unknown') {
      throw new TypeError(`state must be one of ${[...VALID_STATES, 'unknown'].join('|')}`);
    }
    const cell = `${day}-${half}`;
    if (state === 'unknown') {
      const m = this.#byWeek.get(week);
      if (m) {
        m.delete(cell);
        if (m.size === 0) this.#byWeek.delete(week);
      }
      return;
    }
    if (!this.#byWeek.has(week)) this.#byWeek.set(week, new Map());
    this.#byWeek.get(week).set(cell, state);
  }

  /** @returns {'open'|'tight'|'unavailable'|'unknown'} */
  get({ week, day, half }) {
    return this.#byWeek.get(week)?.get(`${day}-${half}`) ?? 'unknown';
  }

  /** @returns {{[cell: string]: state}} */
  weekGrid(week) {
    const out = {};
    const m = this.#byWeek.get(week);
    if (!m) return out;
    for (const [cell, state] of m) out[cell] = state;
    return out;
  }

  /** Plain JSON dump. */
  serialize() {
    const out = {};
    for (const [week, m] of this.#byWeek) {
      out[week] = Object.fromEntries(m);
    }
    return out;
  }

  /** @returns {AvailabilityHints} */
  static deserialize(obj) {
    const h = new AvailabilityHints();
    if (!obj || typeof obj !== 'object') return h;
    for (const [week, cells] of Object.entries(obj)) {
      if (!isValidWeek(week)) continue;
      if (!cells || typeof cells !== 'object') continue;
      for (const [cell, state] of Object.entries(cells)) {
        const [day, half] = cell.split('-');
        try { h.set({ week, day, half, state }); }
        catch { /* skip malformed entry */ }
      }
    }
    return h;
  }

  /** Strip weeks older than `STALE_AFTER_WEEKS` from `now`. Mutates. */
  pruneStale(now = Date.now()) {
    const horizon = isoWeekOf(new Date(now - STALE_AFTER_WEEKS * 7 * 86_400_000));
    for (const week of [...this.#byWeek.keys()]) {
      if (week < horizon) this.#byWeek.delete(week);
    }
  }
}

/**
 * ISO 8601 week label for a date: "YYYY-Www".
 * Matches the format `<input type="week">` returns.
 */
export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year.
  const dayNum = (d.getUTCDay() + 6) % 7;     // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** "Sat-am" / "Sun-pm" given a Date. */
export function halfDayOf(date) {
  const day = VALID_DAYS[(date.getDay() + 6) % 7];     // local-day mapping
  const half = date.getHours() < 12 ? 'am' : 'pm';
  return { day, half, week: isoWeekOf(date) };
}

function isValidWeek(s) {
  return typeof s === 'string' && /^\d{4}-W\d{2}$/.test(s);
}

export { VALID_STATES, VALID_HALVES, VALID_DAYS, STALE_AFTER_WEEKS };
