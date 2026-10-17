/**
 * UsageMetrics — local, in-memory counter for the push-UX feedback
 * loop and other "is this thing actually being used?" measurements.
 *
 * Lifted from `apps/pinboard/src/lib/UsageMetrics.js` 2026-05-08
 * (Tasks V1 = rule-of-two consumer; the per-skill UsageMetrics
 * pattern was originally written for Pinboard V1's closed-beta
 * runbook). Pinboard's `lib/UsageMetrics.js` is now a re-export shim.
 *
 * Records per-event counts and the timestamp of the most recent
 * occurrence.  No persistence — apps that want metrics across
 * restarts snapshot to the pod on their own cadence.
 *
 * Apps interact via three methods only:
 *   - `record(name)`        — increment a counter, stamp lastAt.
 *   - `snapshot()`          — read-only POJO of all counters.
 *   - `reset(name?)`        — drop one counter or all.
 *
 * The whole point is the *discipline* of recording, not the
 * sophistication of the counter.
 */

export class UsageMetrics {
  /** @type {Map<string, { count: number, lastAt: number }>} */
  #counters = new Map();
  #now;

  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now=Date.now]
   */
  constructor({ now } = {}) {
    this.#now = now ?? (() => Date.now());
  }

  /** Increment the named counter. */
  record(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('record: name required');
    const cur = this.#counters.get(name);
    if (!cur) this.#counters.set(name, { count: 1, lastAt: this.#now() });
    else      { cur.count += 1; cur.lastAt = this.#now(); }
  }

  /** Read-only POJO of all counters. */
  snapshot() {
    const out = {};
    for (const [k, v] of this.#counters) out[k] = { ...v };
    return out;
  }

  /** Drop one counter (when name is supplied) or all. */
  reset(name) {
    if (name === undefined) this.#counters.clear();
    else this.#counters.delete(name);
  }
}
