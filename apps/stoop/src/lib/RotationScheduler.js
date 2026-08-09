/**
 * RotationScheduler — periodically rotate the agent's network
 * identity via `core.Agent.rotateIdentity()`.
 *
 * Stoop V1 default cadence: every 30 days, foreground-only.
 *
 * **Substrate candidate (rule of two — first consumer):** scheduled
 * identity rotation is generic to any agentic app that wants a
 * rotating network identity for unlinkability.  When a second app
 * needs it, lift this into a substrate (likely alongside the
 * `CachingDataSource` / `SyncCadence` candidate) — both are part of
 * the "agent operations on a foreground-only schedule" cluster.
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 *
 * Background-rotation (firing while the app is closed) requires
 * native scheduler integration (`BGTaskScheduler` on iOS,
 * `WorkManager` on Android).  Out of scope for V1 (closed-beta
 * users open the app frequently enough; the privacy-doc lists the
 * residual correlation risk as ⚠ partially mitigated).
 */

import { Emitter } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Parameter register (#36) — identity-rotation cadence + grace window (scope:device, kind:internal).
const DEFAULT_INTERVAL_MS  = param({ key: 'stoop.rotationIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * ONE_DAY_MS });
const DEFAULT_GRACE_MS     = param({ key: 'stoop.rotationGraceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 * ONE_DAY_MS });

export class RotationScheduler extends Emitter {
  #agent;
  #intervalMs;
  #gracePeriodSeconds;
  #now;
  #setTimeout;
  #clearTimeout;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  #foreground = false;
  #nextFireAt = null;
  /** Last successful rotation timestamp (ms epoch). null = never rotated. */
  #lastRotatedAt = null;
  #rotating = false;

  /**
   * @param {object} args
   * @param {object} args.agent          a `core.Agent` instance with `rotateIdentity`
   * @param {number} [args.intervalMs=30 days]
   * @param {number} [args.gracePeriodMs=7 days]    grace passed to `rotateIdentity`
   * @param {() => number} [args.now=Date.now]
   * @param {typeof setTimeout}  [args.setTimeoutFn]
   * @param {typeof clearTimeout} [args.clearTimeoutFn]
   * @param {number} [args.lastRotatedAt]   resume timestamp from a persisted store
   */
  constructor({
    agent,
    intervalMs       = DEFAULT_INTERVAL_MS,
    gracePeriodMs    = DEFAULT_GRACE_MS,
    now,
    setTimeoutFn,
    clearTimeoutFn,
    lastRotatedAt,
  } = {}) {
    super();
    if (!agent || typeof agent.rotateIdentity !== 'function') {
      throw new TypeError('RotationScheduler: agent with rotateIdentity required');
    }
    this.#agent              = agent;
    this.#intervalMs         = intervalMs;
    this.#gracePeriodSeconds = Math.floor(gracePeriodMs / 1000);
    this.#now                = now            ?? (() => Date.now());
    this.#setTimeout         = setTimeoutFn   ?? globalThis.setTimeout;
    this.#clearTimeout       = clearTimeoutFn ?? globalThis.clearTimeout;
    this.#lastRotatedAt      = lastRotatedAt ?? null;
  }

  // ── State ────────────────────────────────────────────────────────────────

  get isForeground()   { return this.#foreground; }
  get lastRotatedAt()  { return this.#lastRotatedAt; }
  /** ms epoch of the next scheduled rotation, or null when paused. */
  get nextRotationAt() { return this.#nextFireAt; }

  /**
   * Toggle foreground state.  Going foreground arms the next rotation
   * timer based on `lastRotatedAt + intervalMs` (or `now + intervalMs`
   * if never rotated).  Going background disarms.
   */
  setForeground(value) {
    const wasForeground = this.#foreground;
    this.#foreground = !!value;
    if (this.#foreground && !wasForeground) {
      this.emit('foreground', {});
      const since = this.#lastRotatedAt ?? this.#now();
      this.#nextFireAt = since + this.#intervalMs;
      this.#armNext();
    } else if (!this.#foreground && wasForeground) {
      this.emit('background', {});
      this.#nextFireAt = null;
      this.#disarmTimer();
    }
  }

  /** Force an immediate rotation (e.g. user-initiated "rotate now" button). */
  async rotateNow() {
    if (this.#rotating) return null;
    this.#rotating = true;
    try {
      const result = await this.#agent.rotateIdentity({
        gracePeriodSeconds: this.#gracePeriodSeconds,
        broadcast:          true,
      });
      this.#lastRotatedAt = this.#now();
      this.emit('rotated', { at: this.#lastRotatedAt, result });
      if (this.#foreground) {
        this.#nextFireAt = this.#lastRotatedAt + this.#intervalMs;
        this.#armNext();
      }
      return result;
    } catch (err) {
      this.emit('error', { error: err });
      return null;
    } finally {
      this.#rotating = false;
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
      await this.rotateNow();
      // rotateNow re-arms via #nextFireAt above; nothing else to do.
    }, delay);
  }

  #disarmTimer() {
    if (this.#timer != null) {
      this.#clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
