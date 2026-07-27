/**
 * PushTokenRegistry — relay-side address ↔ push-token map.
 *
 * Populated by `{type: 'register-push-token'}` envelopes that connected
 * clients send after their initial `register`.  Consumed by the relay
 * when a message lands for a peer that's currently disconnected, to wake
 * the device via `PushSender`.
 *
 * DURABILITY (G15, 2026-07-27). V0 was purely in-memory, and that had a failure nobody could see: **every
 * relay restart silently stopped waking every device.** A client re-registers its token only after it
 * reconnects — but a sleeping device never reconnects, so it never re-registers, so it is never woken
 * again. Nothing errors; wakes just stop.
 *
 * An optional `store` (see `PushTokenStore.js`) makes registrations durable. The in-memory Map stays as the
 * working set so the read API remains SYNCHRONOUS — `server.js` calls `get`/`markPushed` on the hot path —
 * and writes go through to the store best-effort. Call `await hydrate()` once at boot.
 *
 * Absent a store, behaviour is byte-for-byte V0.
 */
export class PushTokenRegistry {
  /** @type {Map<string, {token: string, platform: string, registeredAt: number, lastPushedAt: number}>} */
  #byAddress = new Map();

  /** @type {import('./PushTokenStore.js').PushTokenStore|null} */
  #store = null;

  /**
   * @param {object} [opts]
   * @param {import('./PushTokenStore.js').PushTokenStore} [opts.store]  durable backing; absent ⇒ V0 memory-only
   */
  constructor({ store = null } = {}) { this.#store = store; }

  /**
   * Load persisted registrations into the working set. Call ONCE at relay boot, before serving.
   * A store failure is logged by the caller, not thrown here — a relay that cannot read its token file
   * should still start and serve online peers; it just cannot wake sleeping ones until the store recovers.
   *
   * @returns {Promise<number>} how many registrations were restored
   */
  async hydrate() {
    if (!this.#store) return 0;
    const rows = await this.#store.list();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.address || !r?.token) continue;          // tolerate a partial/corrupt row rather than throwing
      this.#byAddress.set(r.address, {
        token: r.token,
        platform: r.platform ?? 'unknown',
        registeredAt: r.registeredAt ?? 0,
        lastPushedAt: 0,                                // deliberately NOT persisted — see PushTokenStore.js
      });
    }
    return this.#byAddress.size;
  }

  /** Write-through, best-effort: the in-memory registration has already happened and stands regardless. */
  #persist(op, arg) {
    if (!this.#store) return;
    Promise.resolve()
      .then(() => (op === 'put' ? this.#store.put(arg) : this.#store.remove(arg)))
      .catch(() => { /* durability degraded; the live registry is unaffected */ });
  }

  /**
   * Register or update a token for an address.  Re-registering replaces
   * the previous record.
   *
   * @param {string} address       peer pubKey (the relay's address space)
   * @param {object} args
   * @param {string} args.token    device push token
   * @param {string} args.platform 'ios'|'android'|'web'
   */
  register(address, { token, platform } = {}) {
    if (!address || typeof address !== 'string') {
      throw new TypeError('PushTokenRegistry.register: address required');
    }
    if (!token || typeof token !== 'string') {
      throw new TypeError('PushTokenRegistry.register: token required');
    }
    const registeredAt = Date.now();
    this.#byAddress.set(address, {
      token,
      platform:     platform ?? 'unknown',
      registeredAt,
      lastPushedAt: 0,
    });
    this.#persist('put', { address, token, platform: platform ?? 'unknown', registeredAt });
  }

  /**
   * Idempotent removal.  Safe to call for an unknown address.
   */
  unregister(address) {
    this.#byAddress.delete(address);
    this.#persist('remove', address);
  }

  /**
   * Look up a token record.  Returns null if the address has none.
   *
   * @returns {{token: string, platform: string, registeredAt: number, lastPushedAt: number}|null}
   */
  get(address) {
    return this.#byAddress.get(address) ?? null;
  }

  /**
   * Update the last-pushed timestamp.  Used by the throttler.  No-op for
   * unknown addresses.
   *
   * NOT persisted, deliberately: it is a throttle hint, and forgetting it across a restart costs at most
   * one extra wake. Persisting it would mean a write on every push to buy nothing.
   */
  markPushed(address, when = Date.now()) {
    const rec = this.#byAddress.get(address);
    if (!rec) return;
    rec.lastPushedAt = when;
  }

  size() { return this.#byAddress.size; }

  /** Test helper: clear all entries (and the store, when one is wired). */
  clear() {
    this.#byAddress.clear();
    if (this.#store) Promise.resolve().then(() => this.#store.clear()).catch(() => {});
  }
}
