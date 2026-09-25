/**
 * SqliteForwardStore — what the relay is HOLDING for addresses that are offline, kept on disk so a restart does not
 * drop it.
 *
 * `ForwardQueue` is the relay's one hold-and-forward owner, and it held everything in a Map: every relay restart
 * (a redeploy, a crash, a box update) silently dropped every message waiting for a sleeping device. The lanes'
 * catch-ups re-deliver from the senders' logs, so the cost was latency rather than data — but latency measured in
 * "until the sender is online again", which for a person's phone can be days.
 *
 * NOT `SqliteQueueStore`: that one stores in-flight multi-recipient REQUESTS (putRequest / addResponse /
 * closeRequest) — a different thing, which is why it could not simply be plugged in here. Same conventions
 * otherwise: `better-sqlite3` injected as `Database` (so the relay runs without native bindings when unset), WAL,
 * one table, and synchronous bodies — `ForwardQueue` is synchronous, and so are these.
 *
 * Rows: `{ id, address, topic, envelope, at }` — `envelope` as JSON, `at` the enqueue time the TTL counts from, so
 * a restart neither extends nor shortens how long an entry is held.
 *
 * @param {object} opts
 * @param {string} [opts.path=':memory:']  db file; `:memory:` for tests
 * @param {Function} opts.Database           the better-sqlite3 constructor
 */
export class SqliteForwardStore {
  #db; #addStmt; #delStmt; #delAddrStmt; #loadStmt;

  constructor({ path = ':memory:', Database } = {}) {
    if (typeof Database !== 'function') {
      throw new TypeError('SqliteForwardStore: pass the better-sqlite3 constructor as `Database` '
        + '(injected so the relay can run without native bindings when no queue db is configured)');
    }
    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS held (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        address   TEXT    NOT NULL,
        topic     TEXT,
        envelope  TEXT    NOT NULL,
        at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS held_by_address ON held (address)`);
    this.#addStmt = this.#db.prepare('INSERT INTO held (address, topic, envelope, at) VALUES (?, ?, ?, ?)');
    this.#delStmt = this.#db.prepare('DELETE FROM held WHERE id = ?');
    this.#delAddrStmt = this.#db.prepare('DELETE FROM held WHERE address = ?');
    this.#loadStmt = this.#db.prepare('SELECT id, address, topic, envelope, at FROM held ORDER BY id');
  }

  /** Keep one held envelope. @returns {number} its id, which `remove` takes */
  add(address, topic, envelope, at) {
    return Number(this.#addStmt.run(address, topic ?? null, JSON.stringify(envelope), at).lastInsertRowid);
  }

  /** Forget one entry (delivered in a drain, given up on, or evicted). Idempotent. */
  remove(id) { if (id != null) this.#delStmt.run(id); }

  /** Forget everything held for an address (its buffer was drained). */
  removeAddress(address) { this.#delAddrStmt.run(address); }

  /** Everything held, oldest first — read once at boot. An unreadable row is skipped, never fatal. */
  load() {
    const out = [];
    for (const r of this.#loadStmt.all()) {
      try { out.push({ id: r.id, address: r.address, topic: r.topic, envelope: JSON.parse(r.envelope), at: r.at }); }
      catch { this.#delStmt.run(r.id); }
    }
    return out;
  }

  close() { this.#db.close(); }
}
