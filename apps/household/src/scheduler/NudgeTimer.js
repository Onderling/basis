/**
 * NudgeTimer — per-(chatId, itemId) `setTimeout` wrapper used by the
 * Phase-4 completion-loop.  The agent calls `schedule()` whenever
 * activity happens for an item; `delayMs` later (default 1 hour per
 * Q-H2.7) the timer fires `onFire({ chatId, itemId })` so a higher
 * layer can post a "what got done?" nudge.
 *
 * This module is intentionally dumb: no knowledge of chats, items,
 * skills, or stores.  It is a thin layer over `setTimeout` keyed by
 * a composite `${chatId}::${itemId}` string.
 *
 * Re-arm semantics (Q-H2.7): repeated `schedule()` for the same key
 * cancels the prior pending timer and re-arms it with a fresh
 * `delayMs`.  The intent is "fire 1 hour after the *latest* activity
 * for this item in this chat".  A `cancel()` call (typically from
 * `markComplete`) just drops the timer.
 *
 * Each timer is `.unref()`'d so a long-pending nudge does not keep
 * the Node process alive past `stop()`.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — default delay before a completion nudge fires (scope:device, kind:internal).
const DEFAULT_DELAY_MS = param({ key: 'household.nudgeDelayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 * 60 * 1000 }); // 1 hour — Q-H2.7

/** @param {string} chatId @param {string} itemId */
function makeKey(chatId, itemId) {
  return `${chatId}::${itemId}`;
}

export class NudgeTimer {
  /** @type {number} */
  #delayMs;

  /** @type {(payload: { chatId: string, itemId: string }) => void | Promise<void>} */
  #onFire;

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  #timers = new Map();

  /**
   * @param {object} args
   * @param {number} [args.delayMs=3_600_000]
   *   Delay between the most recent `schedule()` call and the
   *   `onFire` invocation.  Defaults to 1 hour (Q-H2.7).
   * @param {(payload: { chatId: string, itemId: string }) => void | Promise<void>} args.onFire
   *   Invoked once when a timer matures.  Throws / rejections are
   *   swallowed so a single bad handler can't break the scheduler.
   */
  constructor({ delayMs = DEFAULT_DELAY_MS, onFire } = {}) {
    if (typeof onFire !== 'function') {
      throw new TypeError('NudgeTimer: `onFire` must be a function');
    }
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError('NudgeTimer: `delayMs` must be a non-negative finite number');
    }
    this.#delayMs = delayMs;
    this.#onFire = onFire;
  }

  /**
   * Start (or re-arm) the timer for this `(chatId, itemId)`.  If a
   * timer already exists for the key, it is cancelled and a fresh
   * one is armed for the full `delayMs` from now.
   *
   * @param {string} chatId
   * @param {string} itemId
   */
  schedule(chatId, itemId) {
    const key = makeKey(chatId, itemId);
    const existing = this.#timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      // Auto-clean before invoking, so an `onFire` handler can call
      // back into `schedule()` without the cleanup stomping on it.
      this.#timers.delete(key);
      try {
        const ret = this.#onFire({ chatId, itemId });
        if (ret && typeof ret.then === 'function') {
          // Swallow async rejections so a single bad handler can't
          // crash the scheduler / take down the process.
          ret.catch(() => {});
        }
      } catch {
        // Swallow sync throws for the same reason.
      }
    }, this.#delayMs);

    // Don't hold the event loop open just because a nudge is pending.
    // Guard for environments where `unref` is not present (browsers).
    if (typeof handle === 'object' && handle !== null && typeof handle.unref === 'function') {
      handle.unref();
    }

    this.#timers.set(key, handle);
  }

  /**
   * Cancel a single scheduled timer.  No-op if none is armed for
   * the given key.
   *
   * @param {string} chatId
   * @param {string} itemId
   */
  cancel(chatId, itemId) {
    const key = makeKey(chatId, itemId);
    const handle = this.#timers.get(key);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.#timers.delete(key);
  }

  /**
   * Cancel every timer scheduled for `chatId`.  Linear in the
   * number of armed timers — fine for the expected scale (a few
   * dozen open items per household chat at worst).
   *
   * @param {string} chatId
   */
  cancelAll(chatId) {
    const prefix = `${chatId}::`;
    for (const key of [...this.#timers.keys()]) {
      if (key.startsWith(prefix)) {
        clearTimeout(this.#timers.get(key));
        this.#timers.delete(key);
      }
    }
  }

  /**
   * Number of timers currently armed.  For tests + observability.
   *
   * @returns {number}
   */
  size() {
    return this.#timers.size;
  }

  /**
   * Drain every pending timer.  Idempotent.  After `stop()`, the
   * instance is still usable — subsequent `schedule()` calls will
   * arm new timers.  We picked "still usable" over a hard-stopped
   * state because the typical caller is a long-lived agent that
   * might restart its bridge without re-constructing the scheduler.
   */
  stop() {
    for (const handle of this.#timers.values()) {
      clearTimeout(handle);
    }
    this.#timers.clear();
  }
}

export default NudgeTimer;
