/**
 * tunnelSessions — in-memory session table for the hop-aware task tunnel
 * (Group CC).  Holds one row per open tunnel on the bridge (Bob's) side,
 * keyed by a random tunnelId.
 *
 * Each row binds Alice's outer taskId to Carol's inner taskId so Bob can
 * translate task-scoped OWs between the two sides:
 *
 *   { tunnelId,
 *     aliceAddr, aliceTaskId,
 *     carolAddr, carolTaskId,
 *     carolTask,                        // live Task object from agent.call
 *     originPubKey, originSig, originTs,
 *     createdAt, ttlMs,
 *     sealed: true|false,               // group used BB sealed forwarding?
 *     closing: false }                  // set true after a terminal OW
 *
 * Lifecycle:
 *  - created on receipt of a `tunnel-open` RQ.
 *  - removed when either side sends a terminal OW (task-result /
 *    task-expired / cancel), on TTL expiry, or when the bridge clears
 *    the table (e.g. on stop()).
 *
 * Kept deliberately tiny — no retry, no ordering, no backpressure — all
 * of that is already the responsibility of the outer skill-call layer.
 */
import { Emitter } from '../Emitter.js';

import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — tunnel session lifetime + sweep cadence (scope:device, kind:internal).
export const DEFAULT_TTL_MS = param({ key: 'tunnelSessions.ttlMs',          scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60_000 });   // 10 minutes
export const SWEEP_INTERVAL = param({ key: 'tunnelSessions.sweepIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });        // scan once a minute

/**
 * In-memory table of open hop-tunnel sessions on the bridge side, keyed by tunnelId.
 * Each row binds the originator's outer taskId to the target's inner taskId; a
 * periodic sweeper drops rows whose TTL has elapsed. Emits 'opened', 'closing',
 * and 'closed'.
 */
export class TunnelSessions extends Emitter {
  /** @type {Map<string, object>} */
  #rows = new Map();

  /** @type {NodeJS.Timeout|null} */
  #sweeper = null;

  constructor({ sweepIntervalMs = SWEEP_INTERVAL } = {}) {
    super();
    this.#sweepIntervalMs = sweepIntervalMs;
  }

  #sweepIntervalMs;

  /**
   * Start the TTL sweeper.  Idempotent — calling twice is a no-op.
   */
  start() {
    if (this.#sweeper) return;
    this.#sweeper = setInterval(() => this.#sweep(), this.#sweepIntervalMs);
    // Node-only ergonomics: don't keep the event loop alive just for the sweep.
    this.#sweeper.unref?.();
  }

  /**
   * Stop the sweeper and clear all rows.
   */
  stop() {
    if (this.#sweeper) {
      clearInterval(this.#sweeper);
      this.#sweeper = null;
    }
    for (const [tunnelId] of this.#rows) this.#drop(tunnelId, 'session-stopped');
  }

  /**
   * Add a session row.  Does not allocate the tunnelId — the caller
   * allocates it (typically tunnel-open) so retry logic can key on it.
   */
  add(row) {
    if (!row?.tunnelId) throw new Error('TunnelSessions.add: tunnelId required');
    const complete = {
      ...row,
      createdAt: row.createdAt ?? Date.now(),
      ttlMs:     row.ttlMs     ?? DEFAULT_TTL_MS,
      sealed:    !!row.sealed,
      closing:   false,
    };
    this.#rows.set(row.tunnelId, complete);
    this.emit('opened', { tunnelId: row.tunnelId });
    return complete;
  }

  /** @returns {object|null} */
  get(tunnelId) {
    return this.#rows.get(tunnelId) ?? null;
  }

  /** @returns {object|null} */
  getByCarolTaskId(carolTaskId) {
    for (const row of this.#rows.values()) {
      if (row.carolTaskId === carolTaskId) return row;
    }
    return null;
  }

  /** @returns {object|null} */
  getByAliceTaskId(aliceTaskId) {
    for (const row of this.#rows.values()) {
      if (row.aliceTaskId === aliceTaskId) return row;
    }
    return null;
  }

  has(tunnelId) { return this.#rows.has(tunnelId); }

  /**
   * Mark the session as closing — it still forwards any in-flight OW that
   * arrives, but new `tunnel-open` referring to the same tunnelId are
   * refused.  Used by CC3's cancel handling.
   */
  markClosing(tunnelId, reason) {
    const row = this.#rows.get(tunnelId);
    if (!row || row.closing) return;
    row.closing = true;
    row.closingReason = reason;
    this.emit('closing', { tunnelId, reason });
  }

  /**
   * Remove a session row.  Called on any terminal OW / TTL expiry.
   */
  drop(tunnelId, reason = 'terminal') {
    return this.#drop(tunnelId, reason);
  }

  /** Size (number of open sessions). */
  get size() { return this.#rows.size; }

  /** Iterate rows — mostly for tests and /status skills. */
  *rows() { yield* this.#rows.values(); }

  // ── Private ────────────────────────────────────────────────────────────────

  #drop(tunnelId, reason) {
    const row = this.#rows.get(tunnelId);
    if (!row) return false;
    this.#rows.delete(tunnelId);
    this.emit('closed', { tunnelId, reason });
    return true;
  }

  #sweep() {
    const now = Date.now();
    for (const [tunnelId, row] of this.#rows) {
      if (now - row.createdAt >= row.ttlMs) {
        this.#drop(tunnelId, 'ttl-expired');
      }
    }
  }
}
