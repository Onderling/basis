/**
 * A HELD ROW THE RELAY CANNOT READ IS KEPT, NOT DELETED — until the hold window it was held for has passed.
 *
 * `SqliteForwardStore.load()` used to DELETE every row whose envelope did not parse. A row written by a newer relay
 * (a shape this build does not know), or bytes a half-finished write left behind, was gone at the first boot of the
 * older build: a message held for a sleeping device, lost silently. Now such a row stays on disk, untouched, and is
 * counted; it is dropped only once its `at` is past the hold window — the point where the hold would have dropped it
 * anyway, readable or not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteForwardStore } from '../src/queueStores/SqliteForwardStore.js';
import { ForwardQueue } from '../src/ForwardQueue.js';

const HOUR = 60 * 60_000;

describe('the relay\'s forward store keeps what it cannot read', () => {
  const dirs = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function dbWithRows(rows) {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-fwd-')); dirs.push(dir);
    const dbPath = path.join(dir, 'queue.sqlite');
    new SqliteForwardStore({ path: dbPath, Database }).close();   // the table, as the store makes it
    const raw = new Database(dbPath);
    const ins = raw.prepare('INSERT INTO held (address, topic, envelope, at) VALUES (?, ?, ?, ?)');
    for (const r of rows) ins.run(r.address, null, r.envelope, r.at);
    raw.close();
    return dbPath;
  }
  const countRows = (dbPath) => { const raw = new Database(dbPath); const n = raw.prepare('SELECT COUNT(*) AS n FROM held').get().n; raw.close(); return n; };

  it('an unparseable row inside the hold window survives a boot, and is counted', () => {
    const now = Date.now();
    const dbPath = dbWithRows([
      { address: 'bob', envelope: JSON.stringify({ n: 1 }), at: now - HOUR },
      { address: 'bob', envelope: '{"written by a newer relay', at: now - HOUR },
    ]);
    const s = new SqliteForwardStore({ path: dbPath, Database });
    const rows = s.load({ ttlMs: 24 * HOUR, now });
    expect(rows.map((r) => r.envelope)).toEqual([{ n: 1 }]);
    expect(s.unreadable, 'the unreadable row is not counted').toBe(1);
    s.close();
    expect(countRows(dbPath), 'the unreadable row was deleted at boot').toBe(2);
  });

  it('an unparseable row past the hold window is dropped (the hold would have dropped it anyway)', () => {
    const now = Date.now();
    const dbPath = dbWithRows([{ address: 'bob', envelope: 'not json', at: now - 25 * HOUR }]);
    const s = new SqliteForwardStore({ path: dbPath, Database });
    expect(s.load({ ttlMs: 24 * HOUR, now })).toEqual([]);
    expect(s.unreadable).toBe(0);
    s.close();
    expect(countRows(dbPath)).toBe(0);
  });

  it('with no hold window an unreadable row is never dropped', () => {
    const now = Date.now();
    const dbPath = dbWithRows([{ address: 'bob', envelope: 'not json', at: now - 1000 * HOUR }]);
    const s = new SqliteForwardStore({ path: dbPath, Database });
    expect(s.load()).toEqual([]);
    expect(s.unreadable).toBe(1);
    s.close();
    expect(countRows(dbPath)).toBe(1);
  });

  it('a drain for the address forgets what it delivered, not the row it could not read', () => {
    const now = Date.now();
    const dbPath = dbWithRows([
      { address: 'bob', envelope: JSON.stringify({ n: 1 }), at: now - HOUR },
      { address: 'bob', envelope: 'unreadable', at: now - HOUR },
    ]);
    const s = new SqliteForwardStore({ path: dbPath, Database });
    expect(s.load({ ttlMs: 24 * HOUR, now })).toHaveLength(1);
    s.removeAddress('bob');
    s.close();
    expect(countRows(dbPath), 'the drain deleted the kept row too').toBe(1);
  });

  it('the hold hands its own window to the store at boot', () => {
    const now = Date.now();
    const dbPath = dbWithRows([
      { address: 'bob', envelope: 'fresh but unreadable', at: now - HOUR },
      { address: 'bob', envelope: 'old and unreadable', at: now - 25 * HOUR },
    ]);
    const s = new SqliteForwardStore({ path: dbPath, Database });
    new ForwardQueue({ ttlMs: 24 * HOUR, store: s });
    expect(s.unreadable).toBe(1);
    s.close();
    expect(countRows(dbPath)).toBe(1);
  });
});
