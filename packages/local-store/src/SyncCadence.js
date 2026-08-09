/**
 * SyncCadence — foreground-only periodic sync ticker.
 *
 * **2026-05-08:** lifted from `apps/stoop/src/lib/SyncCadence.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Stoop's `lib/SyncCadence.js` is now a re-export shim.
 *
 * Per the project-wide rule (`Project Files/projects/README.md`
 * § "Pod is truth, local cache is reality"): sync only while the
 * app is foreground.  No background timers, no battery cost when the
 * user isn't looking.
 *
 * Usage:
 *
 *   const cadence = new SyncCadence({
 *     intervalMs: 60_000,
 *     onTick:     async () => { await cache.pullFromInner('items/'); },
 *   });
 *   cadence.setForeground(true);   // app focused → polling on
 *   cadence.setForeground(false);  // app blurred → polling off
 *
 *   // explicit user-initiated refresh:
 *   await cadence.tickNow();
 *
 * Time injection (`now`, `setTimeoutFn`, `clearTimeoutFn`) mirrors
 * `@onderling/notifier`'s pattern so tests can drive the timer
 * deterministically.
 */

import { Emitter } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — foreground sync tick interval (scope:device, kind:internal).
// FLAG: reads as a user-tunable sync interval — candidate for kind:user reclassification.
const DEFAULT_INTERVAL_MS = param({ key: 'localStore.syncIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });

export class SyncCadence extends Emitter {
  #intervalMs;
  #onTick;
  #foreground = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  #now;
  #setTimeout;
  #clearTimeout;
  /** Schedule cursor — next absolute fire time (ms epoch).  Mirrors the
   *  pattern in `@onderling/notifier`'s recurring scheduler so a bulk
   *  fake-timer advance fires the right number of times rather than
   *  collapsing into "delay-from-now". */
  #nextFireAt = null;
  /** True while a tick is currently running (re-entrancy guard). */
  #ticking = false;

  /**
   * @param {object} args
   * @param {() => Promise<void> | void} args.onTick                handler invoked each tick
   * @param {number} [args.intervalMs=60_000]
   * @param {() => number} [args.now=Date.now]
   * @param {typeof setTimeout} [args.setTimeoutFn=setTimeout]
   * @param {typeof clearTimeout} [args.clearTimeoutFn=clearTimeout]
   */
  constructor({
    onTick,
    intervalMs = DEFAULT_INTERVAL_MS,
    now,
    setTimeoutFn,
    clearTimeoutFn,
  } = {}) {
    super();
    if (typeof onTick !== 'function') {
      throw new TypeError('SyncCadence: onTick (function) required');
    }
    this.#onTick       = onTick;
    this.#intervalMs   = intervalMs;
    this.#now          = now            ?? (() => Date.now());
    this.#setTimeout   = setTimeoutFn   ?? globalThis.setTimeout;
    this.#clearTimeout = clearTimeoutFn ?? globalThis.clearTimeout;
  }

  // ── State ────────────────────────────────────────────────────────────────

  get isForeground() { return this.#foreground; }
  get intervalMs()   { return this.#intervalMs; }

  /**
   * Toggle foreground state.  Foreground-on → start polling.
   * Foreground-off → stop the next tick (any in-flight tick completes).
   */
  setForeground(value) {
    const wasForeground = this.#foreground;
    this.#foreground = !!value;
    if (this.#foreground && !wasForeground) {
      this.emit('foreground', {});
      this.#nextFireAt = this.#now() + this.#intervalMs;
      this.#armNext();
    } else if (!this.#foreground && wasForeground) {
      this.emit('background', {});
      this.#nextFireAt = null;
      this.#disarmTimer();
    }
  }

  /**
   * Trigger a tick immediately (foreground or not).  Useful for
   * "Refresh" buttons.  Resets the next scheduled tick if we're
   * foreground.
   */
  async tickNow() {
    await this.#runTick();
    if (this.#foreground) {
      this.#nextFireAt = this.#now() + this.#intervalMs;
      this.#armNext();
    }
  }

  /** Stop everything (cleanup at app shutdown). */
  stop() {
    this.#foreground = false;
    this.#disarmTimer();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  #armNext() {
    this.#disarmTimer();
    if (this.#nextFireAt == null) return;
    const delay = Math.max(0, this.#nextFireAt - this.#now());
    this.#timer = this.#setTimeout(async () => {
      await this.#runTick();
      if (this.#foreground) {
        // Advance the cursor by the configured interval relative to
        // the *previous* fire, not the current clock — keeps cadence
        // exact even if a tick ran long.
        this.#nextFireAt = (this.#nextFireAt ?? this.#now()) + this.#intervalMs;
        this.#armNext();
      }
    }, delay);
  }

  #disarmTimer() {
    if (this.#timer != null) {
      this.#clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #runTick() {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      await this.#onTick();
      this.emit('tick', {});
    } catch (err) {
      this.emit('error', { error: err });
    } finally {
      this.#ticking = false;
    }
  }
}
