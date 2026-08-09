/**
 * errorBuffer.js — Folio v2.2 in-memory ring buffer for SyncEngine errors.
 *
 * The web UI surfaces sync errors loudly (red banner + recent-errors list +
 * yellow auth pill).  Those depend on the server exposing the most recent
 * errors via `GET /status` (so a fresh-loaded page paints the right state
 * before any new WS frames arrive).  This module owns that small in-memory
 * history.
 *
 *   - Capacity: 50 events (configurable).
 *   - Subscribed at server boot to `engine.on('error', …)`; entries are
 *     normalized to `{ ts, phase, relPath, message }`.
 *   - `phase: 'conflict'` is normal flow, NOT a failure — those events are
 *     ignored.
 *   - Survives the process lifetime, NOT restart.  This is documented;
 *     persistence to disk is out of scope for v2.2.
 *
 * Exports:
 *   - `class SyncErrorBuffer`     — the ring buffer + subscription.
 *   - `attachErrorBuffer(engine)` — convenience: build + subscribe in one call.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — ring-buffer capacity for recent sync errors (scope:device, kind:internal).
const DEFAULT_CAPACITY = param({ key: 'folio.errorBufferCapacity', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });

// Errors with these phases are not "failure" surfaces — they belong to the
// normal sync flow (conflict resolution surfaces via its own UI affordance).
// Mirrors PHASE_BLOCKLIST in apps/folio/src/server/static/app.js.
const PHASE_BLOCKLIST = new Set(['conflict']);

export class SyncErrorBuffer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity=50]  max number of events kept in memory.
   */
  constructor({ capacity = DEFAULT_CAPACITY } = {}) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error('SyncErrorBuffer: capacity must be a positive integer');
    }
    this._capacity = capacity;
    /** @type {{ ts: number, phase: string, relPath: string|null, message: string }[]} */
    this._events = [];
    this._unsubs = [];
  }

  /** Push an error event onto the buffer (newest first).  Returns the
   *  normalized entry, or null if the phase was filtered out. */
  push(event) {
    const phase = event?.phase ?? 'unknown';
    if (PHASE_BLOCKLIST.has(phase)) return null;
    const entry = {
      ts:      typeof event?.ts === 'number' ? event.ts : Date.now(),
      phase,
      relPath: event?.relPath ?? null,
      // SyncEngine emits { err: Error }; the WsHub normalizes it to `message`.
      // Accept either shape so the buffer can be fed from either side.
      message: typeof event?.message === 'string'
        ? event.message
        : (event?.err?.message ?? String(event?.err ?? '')),
    };
    this._events.unshift(entry);
    if (this._events.length > this._capacity) {
      this._events.length = this._capacity;
    }
    return entry;
  }

  /** Most-recent event, or null. */
  get lastError() {
    return this._events.length > 0 ? this._events[0] : null;
  }

  /** Up to `n` most-recent events (default 10), newest first. */
  recent(n = 10) {
    if (!Number.isFinite(n) || n <= 0) return [];
    return this._events.slice(0, n);
  }

  /** All entries currently held (newest first).  Snapshot — caller may
   *  mutate the returned array without affecting the buffer. */
  snapshot() {
    return this._events.slice();
  }

  /** Number of events currently held. */
  get size() {
    return this._events.length;
  }

  /** Drop everything. */
  clear() {
    this._events = [];
  }

  /**
   * Subscribe this buffer to a SyncEngine's 'error' event.  Returns the
   * unsubscribe function (also tracked internally so {@link close} drops it).
   */
  attachEngine(engine) {
    if (!engine || typeof engine.on !== 'function') {
      throw new Error('SyncErrorBuffer.attachEngine: engine must be an EventEmitter-like');
    }
    const onError = (e) => { this.push(e); };
    engine.on('error', onError);
    const unsub = () => {
      try { engine.off('error', onError); } catch { /* ignore */ }
    };
    this._unsubs.push(unsub);
    return unsub;
  }

  /** Detach all subscriptions registered via attachEngine(). */
  close() {
    for (const u of this._unsubs) {
      try { u(); } catch { /* ignore */ }
    }
    this._unsubs = [];
  }
}

/**
 * Convenience: build a SyncErrorBuffer and subscribe it to an engine in one
 * call.  Returns the buffer (which carries an internal unsubscriber).
 */
export function attachErrorBuffer(engine, opts) {
  const buf = new SyncErrorBuffer(opts);
  buf.attachEngine(engine);
  return buf;
}
