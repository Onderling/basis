/**
 * ForwardQueue — the single relay hold-and-forward owner.
 *
 * Before this module the relay had TWO independent copies of the same
 * store-and-forward logic:
 *   - `server.js`          — the production broker's `deliverOrEnqueue` +
 *                            per-topic bucketing + caps + push-wake + a
 *                            periodic eviction timer + register-time drain.
 *   - `WsServerTransport`  — the relay-as-a-Transport broker's `#forward` +
 *                            `#enqueue` (expiry-on-write) + `#drainQueue`.
 *
 * Both said the same thing: *deliver to a connected recipient, otherwise
 * buffer the envelope keyed by address, and replay the buffer the moment
 * that address registers; drop entries older than a TTL.* This class is
 * that one forward path. Each caller keeps ONLY its connection handling
 * and hands its buffering policy in as config, so the on-the-wire frames
 * and buffering behaviour are byte-identical to the two prior copies.
 *
 * Policy knobs (each reproduces one of the two prior behaviours exactly):
 *   - `ttlMs`         — buffer lifetime; an entry is expired once
 *                       `now - entry.at >= ttlMs` (both prior copies used
 *                       this same boundary, one via `at > cutoff`, the
 *                       other via `expiresAt > now`).
 *   - `topicAware`    — when true, buffer per (address, topic) bucket and
 *                       cap each bucket at `queueCap`; when false, a single
 *                       bucket per address (the WsServerTransport shape).
 *   - `queueCap`      — per-bucket cap (topic-aware path). `null` = uncapped.
 *   - `queueCapTotal` — global per-address safety valve. `null` = uncapped.
 *   - `evictOnWrite`  — drop that address's expired entries on each enqueue
 *                       (the WsServerTransport lazy-purge shape). When false,
 *                       eviction is driven externally by `evictExpired()` on
 *                       a timer (the server.js shape).
 *   - `onWake(to)`    — optional hook fired after an envelope is buffered
 *                       for an offline address (server.js push-wake).
 *
 * NOTE (seam for C8 / G7): this is hold-and-forward, a DIFFERENT concern
 * from the relay's `QueueStore` port (`queueStores/QueueStore.js`), which
 * models in-flight *multi-recipient request* aggregates (putRequest /
 * addResponse / closeRequest). A later slice may make ForwardQueue conform
 * to a dedicated hold-and-forward port shared with a companion adapter;
 * that port does not exist yet, so this class is the single owner for now.
 */

/** WebSocket.OPEN — the numeric readyState both prior copies checked against. */
const WS_OPEN = 1;

export class ForwardQueue {
  /** address → [{ envelope, topic|null, at }] */
  #buffers = new Map();

  #ttlMs;
  #topicAware;
  #queueCap;
  #queueCapTotal;
  #evictOnWrite;
  #onWake;

  /**
   * @param {object}   [opts]
   * @param {number}   [opts.ttlMs]           buffer lifetime in ms
   * @param {boolean}  [opts.topicAware=false]
   * @param {number|null} [opts.queueCap=null]        per-bucket cap (topic-aware)
   * @param {number|null} [opts.queueCapTotal=null]   global per-address cap
   * @param {boolean}  [opts.evictOnWrite=false]      lazy-purge on enqueue
   * @param {((to: string) => void)|null} [opts.onWake=null]
   */
  constructor({
    ttlMs,
    topicAware    = false,
    queueCap      = null,
    queueCapTotal = null,
    evictOnWrite  = false,
    onWake        = null,
  } = {}) {
    this.#ttlMs         = ttlMs;
    this.#topicAware    = topicAware;
    this.#queueCap      = queueCap;
    this.#queueCapTotal = queueCapTotal;
    this.#evictOnWrite  = evictOnWrite;
    this.#onWake        = onWake;
  }

  /** The wire frame both prior forwards emitted to deliver an envelope. */
  static messageFrame(envelope) {
    return JSON.stringify({ type: 'message', envelope });
  }

  /**
   * Deliver `envelope` to `socket` when it is live, otherwise buffer it for
   * `to`. Returns `'delivered'` or `'queued'` (server.js relies on this to
   * summarise a group-publish fan-out).
   *
   * @param {string} to
   * @param {object} envelope
   * @param {object} [opts]
   * @param {object|null} [opts.socket]  the recipient's live socket, or null
   * @param {string|null} [opts.topic]
   * @param {boolean} [opts.wake=true]   fire `onWake` when this envelope is
   *   buffered for an offline recipient. Pass `false` to hold-forward WITHOUT a
   *   push wake — the relay's per-message no-wake gate for routine events
   *   (governance votes/resolves, reports). The buffering itself is unchanged;
   *   only the wake is suppressed.
   * @returns {'delivered'|'queued'}
   */
  deliverOrEnqueue(to, envelope, { socket = null, topic = null, wake = true } = {}) {
    if (socket && socket.readyState === WS_OPEN) {
      try { socket.send(ForwardQueue.messageFrame(envelope)); }
      catch { /* socket may have raced a close */ }
      return 'delivered';
    }
    this.enqueue(to, envelope, topic);
    if (wake && this.#onWake) this.#onWake(to);
    return 'queued';
  }

  /** Buffer an envelope for an offline address under the configured policy. */
  enqueue(to, envelope, topic = null) {
    if (this.#evictOnWrite) this.#dropExpired(to);
    if (!this.#buffers.has(to)) this.#buffers.set(to, []);
    const buf       = this.#buffers.get(to);
    const bucketKey = this.#topicAware ? (topic ?? null) : null;
    buf.push({ envelope, topic: bucketKey, at: Date.now() });

    // Per-bucket cap (topic-aware path): evict the oldest entry in this bucket.
    if (this.#queueCap != null) {
      let bucketCount = 0;
      for (const m of buf) if (m.topic === bucketKey) bucketCount += 1;
      if (bucketCount > this.#queueCap) {
        const idx = buf.findIndex(m => m.topic === bucketKey);
        if (idx >= 0) buf.splice(idx, 1);
      }
    }
    // Global per-address safety valve.
    if (this.#queueCapTotal != null) {
      while (buf.length > this.#queueCapTotal) buf.shift();
    }
  }

  /**
   * Replay every buffered envelope for `to` to a freshly-registered `socket`,
   * then clear the buffer.
   *
   * @param {string} to
   * @param {object} socket
   * @param {object} [opts]
   * @param {boolean} [opts.evictFirst=false]  drop expired entries before replay
   * @param {((envelope: object) => void)|null} [opts.onEach=null]  per-envelope hook
   */
  drain(to, socket, { evictFirst = false, onEach = null } = {}) {
    let buf = this.#buffers.get(to) ?? [];
    if (evictFirst) buf = buf.filter(m => !this.#isExpired(m));
    this.#buffers.delete(to);
    for (const { envelope } of buf) {
      if (socket.readyState === WS_OPEN) {
        if (onEach) onEach(envelope);
        try { socket.send(ForwardQueue.messageFrame(envelope)); }
        catch { /* socket may have raced a close */ }
      }
    }
  }

  /** Sweep every address's buffer, dropping expired entries (timer path). */
  evictExpired() {
    for (const [addr, buf] of this.#buffers) {
      const fresh = buf.filter(m => !this.#isExpired(m));
      if (fresh.length === 0) this.#buffers.delete(addr);
      else this.#buffers.set(addr, fresh);
    }
  }

  /** Total buffered envelopes across all addresses (introspection/tests). */
  get size() {
    let n = 0;
    for (const buf of this.#buffers.values()) n += buf.length;
    return n;
  }

  #dropExpired(to) {
    const buf = this.#buffers.get(to);
    if (!buf) return;
    const fresh = buf.filter(m => !this.#isExpired(m));
    if (fresh.length === 0) this.#buffers.delete(to);
    else this.#buffers.set(to, fresh);
  }

  #isExpired(m) {
    if (this.#ttlMs == null) return false;
    return (Date.now() - m.at) >= this.#ttlMs;
  }
}
