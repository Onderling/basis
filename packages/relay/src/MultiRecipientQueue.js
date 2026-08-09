/**
 * MultiRecipientQueue — fan-out / fan-in orchestrator for the relay.
 *
 * A multi-recipient request is opened by one caller and addressed to N
 * targets; the queue tracks the in-flight aggregation until either all
 * targets have replied OR the deadline elapses.  Persistence is delegated
 * to a `QueueStore` so the caller can swap memory ↔ SQLite ↔ Redis.
 *
 * Server wiring lives in `server.js`; tests cover this class directly.
 *
 * See `coding-plans/track-E-mobile-push-relay.md` §E2b.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { MemoryQueueStore } from './queueStores/MemoryQueueStore.js';

// Parameter register (#36) — aggregation poll interval + default deadline (scope:device, kind:internal).
const POLL_INTERVAL_MS  = param({ key: 'relay.pollIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });
const DEFAULT_TIMEOUT   = param({ key: 'relay.timeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10_000 });

export class MultiRecipientQueue {
  #store;
  #defaultTimeoutMs;
  #pollIntervalMs;
  #pendingTimers = new Set();

  /**
   * @param {object} opts
   * @param {import('./queueStores/QueueStore.js').QueueStore} [opts.store]
   *   — defaults to MemoryQueueStore.
   * @param {number} [opts.defaultTimeoutMs=10000]
   * @param {number} [opts.pollIntervalMs=50]   — internal; lower for fast tests.
   */
  constructor({ store, defaultTimeoutMs = DEFAULT_TIMEOUT, pollIntervalMs = POLL_INTERVAL_MS } = {}) {
    this.#store            = store ?? new MemoryQueueStore();
    this.#defaultTimeoutMs = defaultTimeoutMs;
    this.#pollIntervalMs   = pollIntervalMs;
  }

  /**
   * Open a fan-out request.  Returns a promise that resolves with the
   * collected responses when all targets reply OR the deadline passes
   * (partial-success semantics).
   *
   * @param {object} opts
   * @param {string}    opts.callerPubKey
   * @param {string[]}  opts.targets        — target pubkeys
   * @param {*}         opts.payload
   * @param {number}    [opts.timeoutMs]
   * @param {(target: string, payload: *, ctx: { id: string }) => (Promise<void>|void)} opts.dispatch
   *   — relay-supplied function that delivers `payload` to one target.  `ctx`
   *   carries the request id so the dispatcher can embed it in its wire frame
   *   for fan-in correlation.
   * @returns {Promise<{ id: string|null, responses: Array, partial: boolean }>}
   */
  async fanOut({ callerPubKey, targets, payload, timeoutMs, dispatch }) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return { id: null, responses: [], partial: false };
    }
    if (typeof dispatch !== 'function') {
      throw new TypeError('MultiRecipientQueue.fanOut: `dispatch` must be a function');
    }

    const id       = newId();
    const deadline = Date.now() + (timeoutMs ?? this.#defaultTimeoutMs);

    const req = {
      id,
      callerPubKey,
      targets,
      expectedResponses: targets.length,
      deadline,
      payload,
      createdAt:         Date.now(),
    };
    await this.#store.putRequest(req);

    // Fire dispatches in parallel; one failing dispatch does NOT abort the
    // fan-out.  We wait for fan-in via `addResponse` calls.
    const ctx = { id };
    const dispatches = targets.map(t =>
      Promise.resolve()
        .then(() => dispatch(t, payload, ctx))
        .catch(err => ({ target: t, error: err })),
    );
    void Promise.allSettled(dispatches);

    return this.#waitForResponses(id, deadline);
  }

  /**
   * Called by the relay server when a fan-in response arrives from a target.
   * Returns the updated request (or null if id is unknown / already closed).
   */
  async addResponse(id, fromPubKey, response) {
    return this.#store.addResponse(id, fromPubKey, response);
  }

  /**
   * Resume in-flight requests after a relay restart.  Returns the count of
   * still-open requests now visible from the store.  Future work: re-attach
   * a wait-loop per resumed request and reconnect callers.
   */
  async resumeOpen() {
    const open = await this.#store.listOpen();
    return open.length;
  }

  async close() {
    for (const t of this.#pendingTimers) clearTimeout(t);
    this.#pendingTimers.clear();
    await this.#store.close?.();
  }

  // ── internal ───────────────────────────────────────────────────────────────

  #waitForResponses(id, deadline) {
    return new Promise((resolve) => {
      const tick = async () => {
        let req;
        try {
          req = await this.#store.getRequest(id);
        } catch {
          return resolve({ id, responses: [], partial: true });
        }
        if (!req) {
          return resolve({ id, responses: [], partial: true });
        }
        if (req.responses.length >= req.expectedResponses) {
          await this.#store.closeRequest(id);
          return resolve({ id, responses: req.responses, partial: false });
        }
        if (Date.now() >= deadline) {
          await this.#store.closeRequest(id);
          return resolve({ id, responses: req.responses, partial: true });
        }
        const timer = setTimeout(() => {
          this.#pendingTimers.delete(timer);
          tick();
        }, this.#pollIntervalMs);
        this.#pendingTimers.add(timer);
        if (typeof timer.unref === 'function') timer.unref();
      };
      tick();
    });
  }
}

function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
