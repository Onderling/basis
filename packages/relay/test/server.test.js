/**
 * startRelay — integration tests.
 * See EXTRACTION-PLAN.md §7 Group S and CODING-PLAN.md Group S.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay } from '../src/server.js';
// Registration is challenge-first (DESIGN-boundary-authentication §7): an address is a public key
// and must be PROVED, so the client and the addresses come from the shared helper rather than being
// string literals. `addr('alice')` is a real key this suite holds; `useIdentity` teaches the helper
// about the identities the group-proof suites below connect as.
import { openClient, send, addr, useIdentity } from './helpers/provenClient.js';
import { AgentIdentity, GroupManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

// ── Self-signed cert fixture, generated per test run so there is no ─────────
// ── on-disk state. Uses selfsigned library if present, otherwise skips TLS. ──

async function loadSelfsigned() {
  try {
    const mod = await import('selfsigned');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for predicate (${timeoutMs}ms)`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

// ── Plain ws:// tests ────────────────────────────────────────────────────────

describe('startRelay — ws://', () => {
  let relay;

  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('listens and returns an ephemeral port', () => {
    expect(relay.port).toBeGreaterThan(0);
    expect(relay.tls).toBe(false);
  });

  it('replies to register with a `registered` ack', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: addr('alice') });

    await waitFor(() => ws.messages.some(m => m.type === 'registered'));
    ws.close();
  });

  it('forwards a send from alice to bob', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    const bob   = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(alice, { type: 'register', address: addr('alice') });
    send(bob,   { type: 'register', address: addr('bob')   });
    await waitFor(() => alice.messages.some(m => m.type === 'registered')
                     && bob.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { hi: true } } });

    await waitFor(() => bob.messages.some(m => m.type === 'message'));
    const delivered = bob.messages.find(m => m.type === 'message');
    expect(delivered.envelope.payload).toEqual({ hi: true });

    alice.close(); bob.close();
  });

  it('buffers messages to an offline peer and drains on register', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    // Send to bob while he's offline.
    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { n: 1 } } });
    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { n: 2 } } });
    // Small delay to let the relay buffer them.
    await new Promise(r => setTimeout(r, 30));

    // Bob comes online — should receive the two buffered messages.
    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });

    await waitFor(() =>
      bob.messages.filter(m => m.type === 'message').length === 2,
    );
    const delivered = bob.messages.filter(m => m.type === 'message');
    expect(delivered.map(m => m.envelope.payload.n)).toEqual([1, 2]);

    alice.close(); bob.close();
  });

  it('broadcasts peer-list on connect and disconnect', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    const bob = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(bob, { type: 'register', address: addr('bob') });

    // Alice should receive a peer-list broadcast that includes bob.
    await waitFor(() => alice.messages.some(
      m => m.type === 'peer-list' && m.peers?.includes(addr('bob')),
    ));

    bob.close();

    await waitFor(() => {
      const peerLists = alice.messages.filter(m => m.type === 'peer-list');
      const last     = peerLists[peerLists.length - 1];
      return last && !last.peers?.includes(addr('bob'));
    });

    alice.close();
  });

  it('responds to a peer-list request with the current client list', async () => {
    const alice = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(alice, { type: 'register', address: addr('alice') });
    await waitFor(() => alice.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'peer-list' });
    await waitFor(() => alice.messages.some(
      m => m.type === 'peer-list' && m.peers?.includes(addr('alice')),
    ));

    alice.close();
  });

  it('rejects register without an address', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register' });

    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    const err = ws.messages.find(m => m.type === 'error');
    expect(err.message).toMatch(/missing address/i);
    ws.close();
  });
});

// ── Multi-recipient (E2b) ────────────────────────────────────────────────────

describe('startRelay — multi-recipient (E2b)', () => {
  let relay;

  beforeEach(async () => {
    relay = await startRelay({
      port: 0,
      // Tight poll interval keeps tests snappy.
      multiRecipientQueueOpts: { pollIntervalMs: 5, defaultTimeoutMs: 1_000 },
    });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('fans out a multi-request to B+C and returns aggregated responses to A', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    const b = await openClient(`ws://127.0.0.1:${relay.port}`);
    const c = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(a, { type: 'register', address: addr('alice') });
    send(b, { type: 'register', address: addr('bob')   });
    send(c, { type: 'register', address: addr('carol') });
    await waitFor(() =>
      a.messages.some(m => m.type === 'registered') &&
      b.messages.some(m => m.type === 'registered') &&
      c.messages.some(m => m.type === 'registered'),
    );

    // A fires the multi-request.
    send(a, {
      type:    'multi-request',
      targets: [addr('bob'), addr('carol')],
      payload: { task: 'ping' },
      timeoutMs: 1_000,
    });

    // B and C each receive a multi-deliver; they reply.
    await waitFor(() => b.messages.some(m => m.type === 'multi-deliver'));
    await waitFor(() => c.messages.some(m => m.type === 'multi-deliver'));

    const bDeliver = b.messages.find(m => m.type === 'multi-deliver');
    const cDeliver = c.messages.find(m => m.type === 'multi-deliver');
    expect(bDeliver.from).toBe(addr('alice'));
    expect(bDeliver.id).toBe(cDeliver.id);
    expect(bDeliver.payload).toEqual({ task: 'ping' });

    send(b, { type: 'multi-response-from-target', id: bDeliver.id, response: { from: 'bob' } });
    send(c, { type: 'multi-response-from-target', id: cDeliver.id, response: { from: 'carol' } });

    await waitFor(() => a.messages.some(m => m.type === 'multi-response'));
    const reply = a.messages.find(m => m.type === 'multi-response');
    expect(reply.id).toBe(bDeliver.id);
    expect(reply.partial).toBe(false);
    expect(reply.responses).toHaveLength(2);
    const fromKeys = reply.responses.map(r => r.fromPubKey).sort();
    expect(fromKeys).toEqual([addr('bob'), addr('carol')].sort());

    a.close(); b.close(); c.close();
  });

  it('returns a partial multi-response when a target does not reply before deadline', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    const b = await openClient(`ws://127.0.0.1:${relay.port}`);
    const c = await openClient(`ws://127.0.0.1:${relay.port}`);

    send(a, { type: 'register', address: addr('alice') });
    send(b, { type: 'register', address: addr('bob')   });
    send(c, { type: 'register', address: addr('carol') });
    await waitFor(() =>
      a.messages.some(m => m.type === 'registered') &&
      b.messages.some(m => m.type === 'registered') &&
      c.messages.some(m => m.type === 'registered'),
    );

    send(a, {
      type:    'multi-request',
      targets: [addr('bob'), addr('carol')],
      payload: { task: 'ping' },
      timeoutMs: 80,
    });

    await waitFor(() => b.messages.some(m => m.type === 'multi-deliver'));
    const bDeliver = b.messages.find(m => m.type === 'multi-deliver');
    // Only bob replies; carol stays silent.
    send(b, { type: 'multi-response-from-target', id: bDeliver.id, response: { from: 'bob' } });

    await waitFor(() => a.messages.some(m => m.type === 'multi-response'), 2_000);
    const reply = a.messages.find(m => m.type === 'multi-response');
    expect(reply.partial).toBe(true);
    expect(reply.responses).toHaveLength(1);
    expect(reply.responses[0].fromPubKey).toBe(addr('bob'));

    a.close(); b.close(); c.close();
  });

  it('rejects multi-request with non-array targets', async () => {
    const a = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(a, { type: 'register', address: addr('alice') });
    await waitFor(() => a.messages.some(m => m.type === 'registered'));

    send(a, { type: 'multi-request', targets: 'nope', payload: {} });
    await waitFor(() => a.messages.some(m => m.type === 'error' && /targets/i.test(m.message)));
    a.close();
  });
});

// ── TLS config validation ───────────────────────────────────────────────────

describe('startRelay — config', () => {
  it('throws when only one of tlsCert / tlsKey is provided', async () => {
    await expect(startRelay({ port: 0, tlsCert: 'cert' })).rejects.toThrow(/both/);
    await expect(startRelay({ port: 0, tlsKey:  'key'  })).rejects.toThrow(/both/);
  });
});

// ── wss:// tests (skipped if `selfsigned` is not installed) ──────────────────

describe('startRelay — wss://', async () => {
  const selfsigned = await loadSelfsigned();
  const testFn = selfsigned ? it : it.skip;

  let relay;
  let cert, key;

  if (selfsigned) {
    // selfsigned v5+ returns a Promise (uses WebCrypto under the hood).
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'localhost' }],
      { days: 1, keySize: 2048 },
    );
    cert = pems.cert;
    key  = pems.private;
  }

  beforeEach(async () => {
    if (!selfsigned) return;
    relay = await startRelay({ port: 0, tlsCert: cert, tlsKey: key });
  });

  afterEach(async () => {
    if (relay) await relay.stop();
  });

  testFn('accepts wss:// connections and round-trips a message', async () => {
    // Self-signed cert → skip hostname/CA checks in the test client.
    const wsOpts = { rejectUnauthorized: false };

    const alice = await openClient(`wss://localhost:${relay.port}`, wsOpts);
    const bob   = await openClient(`wss://localhost:${relay.port}`, wsOpts);
    send(alice, { type: 'register', address: addr('alice') });
    send(bob,   { type: 'register', address: addr('bob')   });
    await waitFor(() => alice.messages.some(m => m.type === 'registered')
                     && bob.messages.some(m => m.type === 'registered'));

    send(alice, { type: 'send', to: addr('bob'), envelope: { _p: 'OW', payload: { secure: true } } });
    await waitFor(() => bob.messages.some(m => m.type === 'message'));
    expect(bob.messages.find(m => m.type === 'message').envelope.payload).toEqual({ secure: true });

    alice.close(); bob.close();
  });
});

// ── Group-membership auth (Q-E.2) ───────────────────────────────────────────

describe('startRelay — group auth (Q-E.2)', () => {
  let admin;
  let member;
  let gm;
  let validProof;
  let strangerProof;

  beforeAll(async () => {
    admin    = await AgentIdentity.generate(new VaultMemory());
    member   = await AgentIdentity.generate(new VaultMemory());
    useIdentity(member);          // this suite connects AS member, so it must be able to prove member
    gm       = new GroupManager({ identity: admin, vault: new VaultMemory() });
    validProof = await gm.issueProof(member.pubKey, 'my-block');

    // A proof for a different group (not in acceptedGroups).
    strangerProof = await gm.issueProof(member.pubKey, 'some-other-block');
  });

  let relay;

  beforeEach(async () => {
    relay = await startRelay({
      port: 0,
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });
  });

  afterEach(async () => {
    if (relay) await relay.stop();
  });

  it('rejects register without a groupProof when acceptedGroups is set', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: member.pubKey });

    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    const err = ws.messages.find(m => m.type === 'error');
    expect(err.message).toBe('NO_PROOF');
    // No `registered` ack must have been sent.
    expect(ws.messages.some(m => m.type === 'registered')).toBe(false);
    try { ws.close(); } catch {}
  });

  it('rejects a proof for a group the relay does not accept', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: member.pubKey, groupProof: strangerProof });

    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    const err = ws.messages.find(m => m.type === 'error');
    expect(err.message).toBe('GROUP_NOT_ACCEPTED');
    expect(ws.messages.some(m => m.type === 'registered')).toBe(false);
    try { ws.close(); } catch {}
  });

  it('accepts a valid proof and proceeds with the register flow', async () => {
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: member.pubKey, groupProof: validProof });

    await waitFor(() => ws.messages.some(m => m.type === 'registered'));
    // No error frame.
    expect(ws.messages.some(m => m.type === 'error')).toBe(false);
    try { ws.close(); } catch {}
  });

  it('open mode (no acceptedGroups) accepts every client (legacy behavior)', async () => {
    const openRelay = await startRelay({ port: 0 }); // no acceptedGroups
    try {
      const ws = await openClient(`ws://127.0.0.1:${openRelay.port}`);
      send(ws, { type: 'register', address: addr('any-address') });
      await waitFor(() => ws.messages.some(m => m.type === 'registered'));
      expect(ws.messages.some(m => m.type === 'error')).toBe(false);
      try { ws.close(); } catch {}
    } finally {
      await openRelay.stop();
    }
  });
});

// ── Phase 2 (Stoop V1, 2026-05-05) — quotas + revocation + rotation ────────

describe('startRelay — Phase 2: per-group revocation', () => {
  let admin, member, gm, proof, relay;

  beforeAll(async () => {
    admin  = await AgentIdentity.generate(new VaultMemory());
    member = await AgentIdentity.generate(new VaultMemory());
    useIdentity(member);          // revoked or not, the client still has to prove its own address
    gm     = new GroupManager({ identity: admin, vault: new VaultMemory() });
    proof  = await gm.issueProof(member.pubKey, 'my-block');
  });

  afterEach(async () => { if (relay) await relay.stop(); });

  it('rejects a member listed in revokedMembers with MEMBER_REVOKED', async () => {
    relay = await startRelay({
      port: 0,
      acceptedGroups: [{
        groupId:        'my-block',
        adminPubKey:    admin.pubKey,
        revokedMembers: [member.pubKey],
      }],
    });
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: member.pubKey, groupProof: proof });
    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    expect(ws.messages.find(m => m.type === 'error').message).toBe('MEMBER_REVOKED');
    try { ws.close(); } catch {}
  });
});

// The per-GROUP connection quota (`quotas.maxConnections` → OVER_QUOTA_CONNECTIONS) was removed on
// 2026-07-31: it made the relay count members of a circle, which is knowledge the relay must not hold
// (`plans/DESIGN-boundary-authentication.md` §2), and it was inert in every deployment we run. Its test
// went with it. What follows guards the replacement, which is circle-blind.
describe('startRelay — per-connection address cap', () => {
  let relay;
  afterEach(async () => { if (relay) await relay.stop(); });

  it('refuses the over-cap register with TOO_MANY_ADDRESSES and keeps the socket usable', async () => {
    relay = await startRelay({ port: 0, maxAddressesPerConnection: 2 });
    const url = `ws://127.0.0.1:${relay.port}`;

    const anna = await openClient(url);
    send(anna, { type: 'register', address: addr('anna@x') });
    send(anna, { type: 'register', address: addr('anna@y') });
    await waitFor(() => anna.messages.filter(m => m.type === 'registered').length === 2);

    send(anna, { type: 'register', address: addr('anna@z') });
    await waitFor(() => anna.messages.some(m => m.type === 'error'));
    expect(anna.messages.find(m => m.type === 'error').message).toBe('TOO_MANY_ADDRESSES');

    // The socket survives, and the addresses it already owns still route — refusing the frame must not
    // take the other circles on this device down with it.
    const bram = await openClient(url);
    send(bram, { type: 'register', address: addr('bram') });
    await waitFor(() => bram.messages.some(m => m.type === 'registered'));
    send(bram, { type: 'send', to: addr('anna@x'), envelope: { subtype: 'still-here' } });
    await waitFor(() => anna.messages.some(m => m.type === 'message'));
    expect(anna.messages.find(m => m.type === 'message').envelope.subtype).toBe('still-here');

    // ...and the refused address was NOT half-registered.
    send(bram, { type: 'peer-list' });
    await waitFor(() => bram.messages.some(m => m.type === 'peer-list' && m.peers.includes(addr('bram'))));
    const peers = bram.messages.filter(m => m.type === 'peer-list').at(-1).peers;
    expect(peers).not.toContain(addr('anna@z'));

    try { anna.close(); bram.close(); } catch {}
  });

  it('re-registering an address the socket already owns is free', async () => {
    relay = await startRelay({ port: 0, maxAddressesPerConnection: 1 });
    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, { type: 'register', address: addr('anna@x') });
    send(ws, { type: 'register', address: addr('anna@x') });
    await waitFor(() => ws.messages.filter(m => m.type === 'registered').length === 2);
    expect(ws.messages.some(m => m.type === 'error')).toBe(false);
    try { ws.close(); } catch {}
  });
});

describe('startRelay — Phase 2: per-group msgsPerDay quota', () => {
  let admin, m1, m2, gm, p1, p2, relay;

  beforeAll(async () => {
    admin = await AgentIdentity.generate(new VaultMemory());
    m1    = await AgentIdentity.generate(new VaultMemory());
    m2    = await AgentIdentity.generate(new VaultMemory());
    useIdentity(m1); useIdentity(m2);
    gm    = new GroupManager({ identity: admin, vault: new VaultMemory() });
    p1    = await gm.issueProof(m1.pubKey, 'my-block');
    p2    = await gm.issueProof(m2.pubKey, 'my-block');
  });

  afterEach(async () => { if (relay) await relay.stop(); });

  it('blocks send with OVER_QUOTA_MSGS_PER_DAY past the cap', async () => {
    relay = await startRelay({
      port: 0,
      acceptedGroups: [{
        groupId:     'my-block',
        adminPubKey: admin.pubKey,
        quotas:      { msgsPerDay: 2 },
      }],
    });

    const ws1 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws1, { type: 'register', address: m1.pubKey, groupProof: p1 });
    await waitFor(() => ws1.messages.some(m => m.type === 'registered'));

    const ws2 = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws2, { type: 'register', address: m2.pubKey, groupProof: p2 });
    await waitFor(() => ws2.messages.some(m => m.type === 'registered'));

    // First two sends from m1 — fine.
    send(ws1, { type: 'send', to: m2.pubKey, envelope: { _p: 'a' } });
    send(ws1, { type: 'send', to: m2.pubKey, envelope: { _p: 'b' } });
    // Third — over cap (m1 + m2 share the per-group counter).
    send(ws1, { type: 'send', to: m2.pubKey, envelope: { _p: 'c' } });

    await waitFor(() => ws1.messages.some(m => m.type === 'error'));
    expect(ws1.messages.find(m => m.type === 'error').message).toBe('OVER_QUOTA_MSGS_PER_DAY');

    try { ws1.close(); ws2.close(); } catch {}
  });
});

describe('startRelay — Phase 2: rotation chain at register', () => {
  let admin, oldId, newId, otherId, gm, oldProof, relay;

  beforeAll(async () => {
    admin   = await AgentIdentity.generate(new VaultMemory());
    oldId   = await AgentIdentity.generate(new VaultMemory());
    newId   = await AgentIdentity.generate(new VaultMemory());
    useIdentity(newId);           // the rotation test connects with the NEW key and must prove it
    otherId = await AgentIdentity.generate(new VaultMemory());
    gm      = new GroupManager({ identity: admin, vault: new VaultMemory() });
    oldProof = await gm.issueProof(oldId.pubKey, 'my-block');
  });

  afterEach(async () => { if (relay) await relay.stop(); });

  it('accepts the new pubKey when a valid rotation chain is presented', async () => {
    const { KeyRotation } = await import('@onderling/core');
    const rotationProof = await KeyRotation.buildProof(oldId, newId.pubKey, 86_400);

    relay = await startRelay({
      port: 0,
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });

    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, {
      type:          'register',
      address:       newId.pubKey,        // CONNECTING with the NEW key
      groupProof:    oldProof,            // proof was for OLD key
      rotationProof,                       // chains old → new
    });

    await waitFor(() => ws.messages.some(m => m.type === 'registered'));
    expect(ws.messages.some(m => m.type === 'error')).toBe(false);
    try { ws.close(); } catch {}
  });

  it('rejects mismatched address without a rotation chain (BINDING_MISMATCH)', async () => {
    relay = await startRelay({
      port: 0,
      acceptedGroups: [{ groupId: 'my-block', adminPubKey: admin.pubKey }],
    });

    const ws = await openClient(`ws://127.0.0.1:${relay.port}`);
    send(ws, {
      type:       'register',
      address:    otherId.pubKey,        // NOT the proof's memberPubKey
      groupProof: oldProof,
    });

    await waitFor(() => ws.messages.some(m => m.type === 'error'));
    expect(ws.messages.find(m => m.type === 'error').message).toBe('BINDING_MISMATCH');
    try { ws.close(); } catch {}
  });
});
