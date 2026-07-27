/**
 * InternalTransport — in-process EventEmitter bus.
 *
 * Two InternalTransport instances share a single InternalBus object.
 * Delivery is asynchronous (microtask) to prevent synchronous call-stack
 * overflow in tests while keeping latency near-zero.
 *
 * Used for:
 *   - Unit tests (no network)
 *   - Multiple agents within the same JS process / browser tab
 */
import { Transport } from './Transport.js';
import { Emitter }   from '../Emitter.js';

/** Shared message bus. Pass the same instance to all InternalTransports that
 *  should be able to reach each other.
 *
 *  `presenceAware` (default false) opts the bus in to membership-based
 *  reachability: while off, its InternalTransports are address-agnostic (they
 *  report `canReach:true` for any address — the long-standing behaviour, so an
 *  InternalTransport can stand in for an address-agnostic relay to a peer that
 *  never joined the bus). While on, a peer is reachable only while its own
 *  transport is connected, so a `disconnect()` becomes a real "unreachable"
 *  signal — what the delivery-guarantee / offline tests key on. */
export class InternalBus extends Emitter {
  constructor({ presenceAware = false } = {}) {
    super();
    this.presenceAware = presenceAware;
  }
}

/**
 * In-process transport: all instances sharing one InternalBus can reach each other.
 * Delivery is deferred by a microtask, so it is asynchronous but near-instant. Used in
 * unit tests and for running multiple agents inside the same JS process or browser tab.
 */
export class InternalTransport extends Transport {
  #bus;
  #listener;

  /**
   * @param {InternalBus} bus
   * @param {string}      address  — this transport's address (usually agent pubKey)
   * @param {object}      [opts]   — forwarded to Transport constructor (identity, etc.)
   */
  constructor(bus, address, opts = {}) {
    super({ address, ...opts });
    this.#bus = bus;
    // Bind once so we can remove the exact same reference in disconnect().
    this.#listener = (envelope) => this._receive(envelope);
  }

  /**
   * Expose the shared bus so callers that want to spin up additional
   * in-process agents (e.g. cap-token-bound bot agents in Tasks)
   * can attach a fresh InternalTransport without threading the bus
   * through multiple call layers.
   */
  get bus() { return this.#bus; }

  /**
   * Look up a sibling InternalTransport on the SAME bus by address (or null).
   * Populated on connect(); lets the B★ in-process fast-path
   * (protocol/taskExchange.invokeAgentSkill) resolve the target agent — via
   * `peerTransport(addr)._ownerAgent` — without a bus hop. Best-effort: an
   * unknown / not-yet-connected peer returns null and the caller falls back to
   * the wire path.
   *
   * @param {string} address
   * @returns {InternalTransport|null}
   */
  peerTransport(address) {
    return this.#bus.__peers?.get(address) ?? null;
  }

  /**
   * Reachability signal. Address-agnostic by default (`true` for any peer,
   * unchanged behaviour). On a `presenceAware` bus it tracks membership: a peer
   * is reachable only while its own InternalTransport is connected — when a
   * sibling calls `disconnect()` it removes its `msg:<addr>` listener and its
   * `__peers` entry, so `_put` toward it would emit to no listener (silently
   * lost). Reporting `canReach:false` then lets routing skip it (and the
   * delivery-guarantee send path hold the message) instead of dropping it.
   *
   * @param {string} peerAddress
   * @returns {boolean}
   */
  canReach(peerAddress) {
    if (!this.#bus?.presenceAware) return true;
    if (peerAddress == null) return true;
    return this.#bus.__peers?.has(peerAddress) ?? false;
  }

  async connect() {
    (this.#bus.__peers ??= new Map()).set(this.address, this);
    this.#bus.on(`msg:${this.address}`, this.#listener);
    // G13 — re-bind every alias. Same rule as every other transport: a (re)connect must restore the
    // per-circle addresses too, or a device is reachable per-circle exactly once.
    await this._rebindAddresses();
    this.emit('connect', { address: this.address });
  }

  async disconnect() {
    for (const addr of this.addresses) {
      this.#bus.__peers?.delete(addr);
      this.#bus.off(`msg:${addr}`, this.#listener);
    }
    this.emit('disconnect');
  }

  // ── G13 aliases ─────────────────────────────────────────────────────────────
  // The set + public API live in the base `Transport`; binding on this bus is exactly what `connect()`
  // does for the primary address — one map entry and one listener — so there is no second mechanism.
  get supportsAliases() { return true; }

  async _bindAddress(address) {
    (this.#bus.__peers ??= new Map()).set(address, this);
    this.#bus.on(`msg:${address}`, this.#listener);
  }

  _unbindAddress(address) {
    this.#bus.__peers?.delete(address);
    this.#bus.off(`msg:${address}`, this.#listener);
  }

  async _put(to, envelope) {
    // Microtask delay: makes delivery async without setTimeout overhead.
    await Promise.resolve();
    this.#bus.emit(`msg:${to}`, envelope);
  }
}
