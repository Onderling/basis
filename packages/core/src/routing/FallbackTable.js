/**
 * FallbackTable — per-peer, per-transport latency and degradation state.
 *
 * Used by RoutingStrategy to pick the best available transport for a peer
 * based on measured round-trip latency and capability flags.
 *
 * patternSupport shape: { streaming?: boolean, bulk?: boolean, bidi?: boolean }
 *
 * A transport is "degraded" for a peer if markDegraded() was called and the
 * `until` timestamp has not elapsed.  Degraded transports are ranked after
 * all healthy transports.
 */
export class FallbackTable {
  /** @type {Map<string, { latencyMs: number, degradedUntil: number|null, patternSupport: object }>} */
  #records = new Map();

  /**
   * Record a successful measurement.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @param {number} latencyMs
   * @param {object} [patternSupport]  e.g. { streaming: true, bulk: false, bidi: false }
   */
  record(peerId, transportName, latencyMs, patternSupport = {}) {
    const key = this.#key(peerId, transportName);
    const existing = this.#records.get(key) ?? {};
    this.#records.set(key, {
      latencyMs,
      degradedUntil:  existing.degradedUntil ?? null,
      patternSupport: { ...existing.patternSupport, ...patternSupport },
    });
  }

  /**
   * Return the transport name with the lowest recorded latency that satisfies
   * the optional filter, from the set of candidates.
   *
   * @param {string}   peerId
   * @param {object}   [filter]               e.g. { streaming: true }
   * @param {string[]} [candidates]           transport names to consider; if omitted, all recorded
   * @returns {string|null}
   */
  getBest(peerId, filter = {}, candidates) {
    const now     = Date.now();
    let   entries = [];

    for (const [k, v] of this.#records) {
      const [pId, tName] = this.#splitKey(k);
      if (pId !== peerId) continue;
      if (candidates && !candidates.includes(tName)) continue;

      // Apply pattern-support filter.
      let ok = true;
      for (const [cap, required] of Object.entries(filter)) {
        if (required && v.patternSupport[cap] === false) { ok = false; break; }
      }
      if (!ok) continue;

      const degraded = v.degradedUntil !== null && now < v.degradedUntil;
      entries.push({ tName, latencyMs: v.latencyMs, degraded });
    }

    if (entries.length === 0) return null;

    // Sort: healthy first, then by latency ascending.
    entries.sort((a, b) => {
      if (a.degraded !== b.degraded) return a.degraded ? 1 : -1;
      return a.latencyMs - b.latencyMs;
    });

    return entries[0].tName;
  }

  /**
   * Mark a transport as degraded for a peer until `until` (ms epoch).
   * Defaults to 30 seconds from now.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @param {number} [until]
   */
  markDegraded(peerId, transportName, until = Date.now() + 30_000) {
    const key     = this.#key(peerId, transportName);
    const existing = this.#records.get(key) ?? { latencyMs: Infinity, patternSupport: {} };
    this.#records.set(key, { ...existing, degradedUntil: until });
  }

  /**
   * Lift a degraded mark early — the transport has evidence the peer is reachable again (it rediscovered it), so the
   * penalty for a failure that is no longer true must not outlast it. A record without a mark is left as it is.
   *
   * @param {string} peerId
   * @param {string} transportName
   */
  clearDegraded(peerId, transportName) {
    const key = this.#key(peerId, transportName);
    const existing = this.#records.get(key);
    if (existing?.degradedUntil) this.#records.set(key, { ...existing, degradedUntil: null });
  }

  /**
   * Return true if the transport is currently degraded for the given peer.
   *
   * @param {string} peerId
   * @param {string} transportName
   * @returns {boolean}
   */
  isDegraded(peerId, transportName) {
    const v = this.#records.get(this.#key(peerId, transportName));
    return !!v?.degradedUntil && Date.now() < v.degradedUntil;
  }

  /**
   * Return all recorded entries for a peer.
   * @param {string} peerId
   * @returns {Array<{ transportName: string, latencyMs: number, degradedUntil: number|null, patternSupport: object }>}
   */
  getAll(peerId) {
    const out = [];
    for (const [k, v] of this.#records) {
      const [pId, tName] = this.#splitKey(k);
      if (pId === peerId) out.push({ transportName: tName, ...v });
    }
    return out;
  }

  /**
   * Remove all recorded data for a peer.
   * @param {string} peerId
   */
  clear(peerId) {
    for (const k of [...this.#records.keys()]) {
      if (this.#splitKey(k)[0] === peerId) this.#records.delete(k);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #key(peerId, transportName) {
    return `${peerId}\x00${transportName}`;
  }

  #splitKey(k) {
    const i = k.indexOf('\x00');
    return [k.slice(0, i), k.slice(i + 1)];
  }
}
