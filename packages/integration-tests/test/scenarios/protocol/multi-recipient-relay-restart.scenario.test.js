/**
 * T.4 — Protocol scenarios — multi-recipient + relay restart.
 *
 * Story: Alice broadcasts to 5 peers via E2b; mid-flight, the relay
 * restarts; per Q-E.3 lock the SQLite queue resumes; partial responses
 * returned to Alice with `partial: true`.
 *
 * What we actually test (within the v1 surface):
 *
 *   1. Alice issues a `multi-request` to 5 targets via the relay's
 *      WebSocket protocol.  The relay's MultiRecipientQueue is backed
 *      by a SqliteQueueStore so the row survives a relay process bounce.
 *
 *   2. Two targets reply BEFORE the relay restarts; their responses are
 *      persisted to SQLite (durable; observed via store.listOpen() →
 *      `responses.length === 2`).
 *
 *   3. The relay is stopped and started again, sharing the SAME on-disk
 *      SQLite file (per Q-E.3 lock on durable queue persistence).
 *      `store.listOpen()` shows the still-open request after restart;
 *      `mrQueue.resumeOpen()` reports it.
 *
 *   4. Lab gap: the in-process v1 wait-loop is per-connection, so
 *      Alice's original `multi-request` future is dropped when the relay
 *      goes down — the restart-resume path documented in §T.4 §Notes is
 *      partial in v1.  We verify the durable side (the store), not a
 *      cross-restart Promise resolution.  Q-E.3 second-half work (re-
 *      attaching wait-loops + reconnecting callers) is tracked separately.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm }     from 'node:fs/promises';
import { tmpdir }          from 'node:os';
import { join, dirname }   from 'node:path';
import { fileURLToPath }   from 'node:url';
import { startRelay }            from '@onderling/relay';
import nacl                     from 'tweetnacl';
// Registration is challenge-first since 2026-07-31 (DESIGN-boundary-authentication §7): an address
// is a public key the relay makes you prove. The five targets below are therefore real keys, and the
// client answers the challenge — everything else about this scenario is unchanged.
import { AgentIdentity, addressPossessionMessage, b64encode } from '@onderling/core';

// The relay package does not currently re-export its queue stores at the
// top level (its `exports` map only exposes `.`).  Resolve their files via
// node_modules to keep this test independent of an SDK-side surface change
// — adding the exports is tracked as a follow-up TODO (§T.4 §Notes).
//
// `ws` is only present under @onderling/relay/node_modules/ws (transitive
// dep), so we resolve it through the relay's nested install too.
const __dirname  = dirname(fileURLToPath(import.meta.url));
const RELAY_NM   = join(__dirname, '../../../node_modules/@onderling/relay');
const RELAY_SRC  = join(RELAY_NM, 'src');
const { SqliteQueueStore }    = await import(`${RELAY_SRC}/queueStores/SqliteQueueStore.js`);
const { MultiRecipientQueue } = await import(`${RELAY_SRC}/MultiRecipientQueue.js`);
const { WebSocket }           = await import(`${RELAY_NM}/node_modules/ws/wrapper.mjs`);

// ── ws client helpers (mirroring relay/test/server.test.js) ───────────────────

/** label → keypair; the address IS the public key, so the labels below name real keys. */
const keys = new Map();
function keyFor(label) {
  if (!keys.has(label)) {
    const seed = new Uint8Array(32);
    seed.set(new TextEncoder().encode(label).slice(0, 31));
    seed[31] = keys.size + 1;
    keys.set(label, { seed, address: AgentIdentity.pubKeyFromSeed(seed) });
  }
  return keys.get(label);
}
const addr = (label) => keyFor(label).address;
function proofFor(address, nonce) {
  const rec = [...keys.values()].find((k) => k.address === address);
  if (!rec) return null;
  const kp = nacl.sign.keyPair.fromSeed(rec.seed);
  return b64encode(nacl.sign.detached(
    new TextEncoder().encode(addressPossessionMessage(address, nonce)), kp.secretKey,
  ));
}

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      ws.messages.push(msg);
      if (msg.type !== 'challenge') return;
      const proof = proofFor(msg.address, msg.nonce);
      if (proof) ws.send(JSON.stringify({ type: 'register-proof', address: msg.address, nonce: msg.nonce, proof }));
    });
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

async function waitFor(predicate, timeoutMs = 2_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for predicate (${timeoutMs}ms)`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('protocol — multi-recipient + relay restart (durable SQLite queue)', () => {
  let tmpDir;
  let dbPath;
  let relay;
  let store;

  beforeEach(async () => {
    tmpDir  = await mkdtemp(join(tmpdir(), 'onderling-mrq-'));
    dbPath  = join(tmpDir, 'queue.sqlite');
  });

  afterEach(async () => {
    try { await relay?.stop(); } catch {}
    try { await store?.close?.(); } catch {}
    relay = null; store = null;
    if (tmpDir) { try { await rm(tmpDir, { recursive: true, force: true }); } catch {} }
    tmpDir = null; dbPath = null;
  });

  it('persists in-flight requests to SQLite; resumes open requests after a relay restart', async () => {
    const TARGETS = ['p1', 'p2', 'p3', 'p4', 'p5'].map(addr);

    // ── Boot relay #1 with a SQLite-backed multi-recipient queue ──────────
    store = new SqliteQueueStore({ path: dbPath });
    let mrQueue = new MultiRecipientQueue({
      store,
      pollIntervalMs:   5,
      defaultTimeoutMs: 60_000,   // long enough to span the restart
    });
    relay = await startRelay({ port: 0, multiRecipientQueue: mrQueue });

    // ── Wire alice + the 5 targets ────────────────────────────────────────
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    const targets = [];
    for (const t of TARGETS) {
      const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
      send(ws, { type: 'register', address: t });
      await waitFor(() => ws.messages.some(m => m.type === 'registered'));
      targets.push({ name: t, ws });
    }

    // ── Alice fans out to all 5 ──────────────────────────────────────────
    send(alice, {
      type:      'multi-request',
      targets:   TARGETS,
      payload:   { task: 'broadcast' },
      timeoutMs: 60_000,
    });

    // Wait for every target to receive a multi-deliver — confirms the
    // queue row was persisted before any restart.
    for (const t of targets) {
      await waitFor(() => t.ws.messages.some(m => m.type === 'multi-deliver'));
    }
    const requestId = targets[0].ws.messages
      .find(m => m.type === 'multi-deliver').id;
    expect(typeof requestId).toBe('string');

    // ── Two of the five reply before the relay goes down ──────────────────
    for (let i = 0; i < 2; i++) {
      const t = targets[i];
      const deliver = t.ws.messages.find(m => m.type === 'multi-deliver');
      send(t.ws, {
        type:     'multi-response-from-target',
        id:       deliver.id,
        response: { from: t.name, ok: true },
      });
    }

    // Wait for the SQLite store to reflect 2 captured responses.
    await waitFor(async () => {
      const req = await store.getRequest(requestId);
      return req && req.responses.length === 2;
    });

    // ── Restart the relay (process-bounce) ────────────────────────────────
    // We reuse the SAME SQLite file path; per Q-E.3 the store is the unit
    // of durability.  Open in-memory state (in-flight Promise, sockets,
    // poll timers) is lost — the v1 surface for cross-restart Promise
    // resumption is documented in §T.4 §Notes.
    await relay.stop();

    // Close + reopen the store handle so we exercise the reload path
    // (better-sqlite3 honours WAL + foreign keys; reopening proves the
    // durable rows survived).
    await store.close();
    store = new SqliteQueueStore({ path: dbPath });
    mrQueue = new MultiRecipientQueue({
      store,
      pollIntervalMs:   5,
      defaultTimeoutMs: 60_000,
    });

    // Resume should return >= 1 still-open request (our broadcast).
    const resumeCount = await mrQueue.resumeOpen();
    expect(resumeCount).toBeGreaterThanOrEqual(1);

    relay = await startRelay({ port: 0, multiRecipientQueue: mrQueue });

    // The persisted request is still visible from the new process.
    const reqAfter = await store.getRequest(requestId);
    expect(reqAfter).not.toBeNull();
    expect(reqAfter.id).toBe(requestId);
    expect(reqAfter.targets).toEqual(TARGETS);
    expect(reqAfter.responses).toHaveLength(2);
    // The two early responders are still in there, byte-identical.
    const fromKeys = reqAfter.responses.map(r => r.fromPubKey).sort();
    expect(fromKeys).toEqual([addr('p1'), addr('p2')].sort());
    expect(reqAfter.responses[0].response).toEqual({ from: addr('p1'), ok: true });

    // ── Confirm partial-set semantics by closing the request via the
    // queue's normal deadline path: simulate a response from p3 to ensure
    // the durable store still accepts new responses after restart, then
    // close.  This proves "queue resumes" end-to-end at the store layer.
    const updated = await mrQueue.addResponse(requestId, addr('p3'), { from: addr('p3'), ok: true });
    expect(updated?.responses).toHaveLength(3);

    // Close the request — mirroring the deadline-elapsed path inside
    // #waitForResponses.  After close, listOpen no longer surfaces it,
    // and the snapshot we hold is the partial fan-in (3 of 5).
    await store.closeRequest(requestId);
    const stillOpen = await store.listOpen();
    expect(stillOpen.find(r => r.id === requestId)).toBeUndefined();

    // Final assertion: the partial snapshot (the data that would have
    // been returned to Alice with `partial: true` had her socket been
    // re-attached to a resumed wait-loop) is exactly 3 responses out of 5.
    const finalReq = await store.getRequest(requestId);
    expect(finalReq.responses).toHaveLength(3);
    expect(finalReq.targets.length - finalReq.responses.length).toBe(2);

    // Cleanup
    alice.close();
    for (const t of targets) t.ws.close();
  }, 10_000);
});
