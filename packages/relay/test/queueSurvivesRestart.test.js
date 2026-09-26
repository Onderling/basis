/**
 * A MESSAGE HELD FOR A SLEEPING DEVICE SURVIVES A RELAY RESTART.
 *
 * The relay holds what it cannot deliver until the address registers. That hold lived in a Map, so a restart — a
 * redeploy, a crash, a box update — dropped every waiting message, silently. With a queue db configured it is kept
 * on disk: a real relay is started, a message is sent to an address that is not connected, the relay is STOPPED and a
 * new one started on the same db, and the address registers with the new one → the message is delivered.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startRelay } from '../src/server.js';
import { SqliteForwardStore } from '../src/queueStores/SqliteForwardStore.js';
import { openClient, send, addr } from './helpers/provenClient.js';

async function waitFor(predicate, timeoutMs = 3_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('the relay\'s held messages survive a restart', () => {
  const dirs = []; const relays = []; const stores = [];
  afterEach(async () => {
    for (const r of relays.splice(0)) { try { await r.stop(); } catch { /* already stopped */ } }
    for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('held for an offline address, the relay restarts, the address registers → delivered', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-queue-')); dirs.push(dir);
    const dbPath = path.join(dir, 'queue.sqlite');
    const open = () => { const s = new SqliteForwardStore({ path: dbPath, Database }); stores.push(s); return s; };

    // relay 1: alice sends to bob, who is not connected → held
    const store1 = open();
    const relay1 = await startRelay({ port: 0, forwardStore: store1 }); relays.push(relay1);
    const alice = await openClient(`ws://127.0.0.1:${relay1.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { n: 1, note: 'held across a restart' } } });
    await new Promise((r) => setTimeout(r, 100));
    alice.close();

    // the restart: relay 1 stops (its memory with it); relay 2 opens the same db
    await relay1.stop(); relays.splice(relays.indexOf(relay1), 1);
    store1.close(); stores.splice(stores.indexOf(store1), 1);
    const relay2 = await startRelay({ port: 0, forwardStore: open() }); relays.push(relay2);

    // bob wakes up and registers with the new relay
    const bob = await openClient(`ws://127.0.0.1:${relay2.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'message'));
    expect(bob.messages.find((m) => m.type === 'message').envelope.payload).toEqual({ n: 1, note: 'held across a restart' });
    bob.close();
  });

  it('delivered once means gone: a second restart does not deliver it again', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-queue-')); dirs.push(dir);
    const dbPath = path.join(dir, 'queue.sqlite');
    const s = new SqliteForwardStore({ path: dbPath, Database }); stores.push(s);
    const relay = await startRelay({ port: 0, forwardStore: s }); relays.push(relay);
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some((m) => m.type === 'registered'));
    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { n: 2 } } });
    await waitFor(() => s.load().length === 1);   // held on disk while bob is away
    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });
    await waitFor(() => bob.messages.some((m) => m.type === 'message'));
    expect(s.load(), 'the drain forgot what it delivered').toEqual([]);
    alice.close(); bob.close();
  });

  it('gone means gone on disk too: a delivered envelope leaves no bytes behind (secure_delete)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-queue-')); dirs.push(dir);
    const dbPath = path.join(dir, 'queue.sqlite');
    const s = new SqliteForwardStore({ path: dbPath, Database });
    const marker = 'MARKER-' + 'x'.repeat(64) + '-held-then-forgotten';
    const id = s.add('addr', null, { payload: marker }, Date.now());
    s.remove(id);
    s.close();   // checkpoints and drops the WAL, so the main file is all there is
    const bytes = readFileSync(dbPath, 'latin1');
    expect(bytes.includes(marker), 'the forgotten envelope is still readable from the file').toBe(false);
  });
});
