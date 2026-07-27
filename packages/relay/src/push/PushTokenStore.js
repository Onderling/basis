/**
 * PushTokenStore — durable storage for the relay's address ↔ push-token map (G15).
 *
 * `PushTokenRegistry` was in-memory only, which had a failure nobody could see: **every relay restart
 * silently stopped waking every device.** Tokens are re-registered by a client only after it reconnects and
 * sends `register-push-token` — but a device that is asleep never reconnects, so it never re-registers, so
 * it is never woken again. The system looks healthy and quietly stops delivering.
 *
 * Mirrors `QueueStore`'s shape (abstract base + Memory/Sqlite implementations, same file conventions), as
 * the original TODO in `PushTokenRegistry` proposed.
 *
 * ── What is persisted, and what deliberately is NOT ──────────────────────────────────────────────────────
 * `registeredAt` and the token itself are durable facts: losing them loses the wake.
 * `lastPushedAt` is NOT persisted — it is a throttle timestamp, and the cost of forgetting it is at most one
 * extra wake after a restart. Persisting it would mean a write on EVERY push, which is a lot of I/O to buy
 * nothing. Stated here so the omission reads as a decision rather than an oversight.
 */

/**
 * @abstract
 * Record shape round-tripped by implementations: `{ address, token, platform, registeredAt }`.
 */
export class PushTokenStore {
  /** Persist (or replace) one address's token record. @returns {Promise<void>} */
  async put(_rec) { throw new Error('PushTokenStore.put() not implemented'); }

  /** Remove an address. Idempotent. @returns {Promise<void>} */
  async remove(_address) { throw new Error('PushTokenStore.remove() not implemented'); }

  /** Every stored record — read once at boot to rehydrate. @returns {Promise<object[]>} */
  async list() { throw new Error('PushTokenStore.list() not implemented'); }

  /** Drop everything (tests / operator reset). @returns {Promise<void>} */
  async clear() { throw new Error('PushTokenStore.clear() not implemented'); }
}

/** In-memory implementation — the default, and what the tests use. Behaves exactly as V0 did. */
export class MemoryPushTokenStore extends PushTokenStore {
  #rows = new Map();

  async put(rec) { this.#rows.set(rec.address, { ...rec }); }
  async remove(address) { this.#rows.delete(address); }
  async list() { return [...this.#rows.values()].map((r) => ({ ...r })); }
  async clear() { this.#rows.clear(); }
}

/**
 * SQLite implementation — production. `better-sqlite3` is synchronous C bindings, so the method bodies do
 * not await anything; they stay `async` to satisfy the interface (same convention as `SqliteQueueStore`).
 *
 * @param {object} [opts]
 * @param {string} [opts.path=':memory:']  db file; `:memory:` for tests
 */
export class SqlitePushTokenStore extends PushTokenStore {
  #db; #putStmt; #delStmt; #listStmt; #clearStmt;

  constructor({ path = ':memory:', Database } = {}) {
    super();
    if (typeof Database !== 'function') {
      throw new TypeError('SqlitePushTokenStore: pass the better-sqlite3 constructor as `Database` '
        + '(injected so the relay can run without native bindings in tests)');
    }
    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        address       TEXT PRIMARY KEY,
        token         TEXT NOT NULL,
        platform      TEXT NOT NULL,
        registeredAt  INTEGER NOT NULL
      )`);
    this.#putStmt = this.#db.prepare(
      `INSERT INTO push_tokens (address, token, platform, registeredAt) VALUES (@address, @token, @platform, @registeredAt)
       ON CONFLICT(address) DO UPDATE SET token=@token, platform=@platform, registeredAt=@registeredAt`);
    this.#delStmt = this.#db.prepare('DELETE FROM push_tokens WHERE address = ?');
    this.#listStmt = this.#db.prepare('SELECT address, token, platform, registeredAt FROM push_tokens');
    this.#clearStmt = this.#db.prepare('DELETE FROM push_tokens');
  }

  async put(rec) { this.#putStmt.run(rec); }
  async remove(address) { this.#delStmt.run(address); }
  async list() { return this.#listStmt.all(); }
  async clear() { this.#clearStmt.run(); }
  close() { this.#db.close(); }
}
