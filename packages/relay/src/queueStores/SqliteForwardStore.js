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
  #db; #addStmt; #delStmt; #delAddrStmt; #loadStmt; #idsForAddrStmt;
  /** ids of rows `load` could not read: kept on disk, never handed out, never deleted by a drain */
  #kept = new Set();

  constructor({ path = ':memory:', Database } = {}) {
    if (typeof Database !== 'function') {
      throw new TypeError('SqliteForwardStore: pass the better-sqlite3 constructor as `Database` '
        + '(injected so the relay can run without native bindings when no queue db is configured)');
    }
    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    // "Delivered once means gone" must hold on the DISK too: without this, a deleted row's bytes — the cleartext
    // routing header and the sealed payload — stay in the file's free pages until something overwrites them, so a
    // forensic read of the volume would still find what the relay had "forgotten". Zeroed at delete instead.
    this.#db.pragma('secure_delete = ON');
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
    this.#idsForAddrStmt = this.#db.prepare('SELECT id FROM held WHERE address = ?');
  }

  /** Keep one held envelope. @returns {number} its id, which `remove` takes */
  add(address, topic, envelope, at) {
    return Number(this.#addStmt.run(address, topic ?? null, JSON.stringify(envelope), at).lastInsertRowid);
  }

  /** Forget one entry (delivered in a drain, given up on, or evicted). Idempotent. */
  remove(id) { if (id != null) this.#delStmt.run(id); }

  /** Forget everything held for an address (its buffer was drained) — except the rows `load` could not read. */
  removeAddress(address) {
    if (this.#kept.size === 0) { this.#delAddrStmt.run(address); return; }
    for (const { id } of this.#idsForAddrStmt.all(address)) if (!this.#kept.has(id)) this.#delStmt.run(id);
  }

  /** How many rows the last `load` could not read and kept on disk. */
  get unreadable() { return this.#kept.size; }

  /**
   * Everything held, oldest first — read once at boot.
   *
   * A row whose envelope does not parse (a newer relay's shape, a torn write) is NOT deleted: it stays on disk
   * untouched, is counted (`unreadable`) and said once in the log (a count, never content), so a later build or an
   * operator can still read it. It is dropped only once its `at` is past the hold window (`ttlMs`), when the hold
   * would have dropped it readable or not. No `ttlMs` → never dropped.
   *
   * @param {object} [opts]
   * @param {number|null} [opts.ttlMs=null]  the hold window (`ForwardQueue` passes its own)
   * @param {number} [opts.now=Date.now()]
   */
  load({ ttlMs = null, now = Date.now() } = {}) {
    const out = [];
    this.#kept.clear();
    for (const r of this.#loadStmt.all()) {
      try { out.push({ id: r.id, address: r.address, topic: r.topic, envelope: JSON.parse(r.envelope), at: r.at }); }
      catch {
        if (ttlMs != null && (now - r.at) >= ttlMs) this.#delStmt.run(r.id);
        else this.#kept.add(r.id);
      }
    }
    if (this.#kept.size > 0) {
      console.warn(`[relay] forward store: ${this.#kept.size} held row(s) not readable by this build — kept on disk, `
        + 'not delivered, dropped once past the hold window');
    }
    return out;
  }

  close() { this.#db.close(); }
}
