/**
 * companion-node M2 — the durable SEALED INBOX over a REAL relay + RelayTransport.
 *
 * Proves the rung-c holder: the node HOLDS sealed messages for its owner while
 * the device is away and DRAINS them on reconnect — sealed-only (never sees
 * plaintext, never decrypts), owner-gated drain, durable across a restart, and
 * a CONTENTLESS reliable wake fired on deposit. We assert the RESULT (real
 * ciphertext held, real plaintext recovered only by the key-holder), never that
 * a handshake merely "ran".
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Agent, AgentIdentity, Parts } from '@onderling/core';
import { VaultMemory }                 from '@onderling/vault';
import { RelayTransport }              from '@onderling/transports';
import { PushSender }                  from '@onderling/relay';
import { seal, open, generateKeypair } from '@onderling/pod-client/sealing';

import { startCompanionNode }          from '../src/index.js';
import {
  createSealedInbox, MemorySealedInboxStore, FileSealedInboxStore, buildDrainDigest,
} from '../src/sealedInbox.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }             from 'node:os';
import { join }               from 'node:path';

/** Records every reliable-wake send so we can assert the CONTENTLESS shape. */
class RecordingWakeSender extends PushSender {
  constructor() { super(); this.calls = []; }
  async send(token, payload, opts) { this.calls.push({ token, payload, opts }); return { ok: true }; }
}

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } }
});

async function makeDevice(host, identity) {
  const id = identity ?? await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity: id, transport: new RelayTransport({ relayUrl: host.relayUrl, identity: id }), label: 'device',
  });
  await agent.start();
  await agent.hello(host.agent.address);
  cleanups.push(() => agent.stop?.());
  return agent;
}

const dataOf = async (p) => Parts.data(await p);

describe('companion-node M2 — sealed inbox: hold → wake → drain → deliver', () => {
  it('holds a sealed message for the away owner, fires ONE contentless wake, owner drains + decrypts (no loss)', async () => {
    // Bob (owner): a network identity (drain gate) + a SEPARATE sealing keypair (open).
    const bobNet   = await AgentIdentity.generate(new VaultMemory());
    const bobSeal  = generateKeypair();
    const wake     = new RecordingWakeSender();

    const host = await startCompanionNode({
      identityVault:    new VaultMemory(),
      gate:             false,
      inbox:            true,
      inboxOwnerPubKey: bobNet.pubKey,
      inboxStore:       new MemorySealedInboxStore(),
      inboxWakeSender:  wake,
      inboxWakeToken:   'tok-bob',
    });
    cleanups.push(() => host.stop());

    // Ann (a peer, NOT the owner) seals a message to Bob and deposits it while
    // Bob's device is away (not connected).
    const ann = await makeDevice(host);
    const plaintext = 'hey Bob — the meeting moved to 3pm';
    const sealed = seal(plaintext, [bobSeal.publicKey]);
    const dep1 = await dataOf(ann.invoke(host.agent.address, 'inbox.deposit', { sealed, topic: 'dm' }));
    const dep2 = await dataOf(ann.invoke(host.agent.address, 'inbox.deposit',
      { sealed: seal('and bring the folder', [bobSeal.publicKey]), topic: 'dm' }));
    expect(dep1.ok).toBe(true);
    expect(dep2.ok).toBe(true);
    expect(dep2.count).toBe(2);

    // ── The reliable wake fired — CONTENTLESS, and BATCHED (one wake, not two).
    expect(wake.calls).toHaveLength(1);
    expect(wake.calls[0].token).toBe('tok-bob');
    expect(wake.calls[0].payload).toEqual({ wake: true, hint: 'message-pending' });
    expect(wake.calls[0].opts).toMatchObject({ platform: 'ios' });

    // ── SEALED-ONLY at rest: the store holds only ciphertext — NO plaintext.
    const snapshot = await host.inbox.store.snapshot();
    const atRest = JSON.stringify(snapshot);
    expect(atRest).not.toContain('meeting');
    expect(atRest).not.toContain('folder');
    expect(atRest).toContain('fp1:');                 // the sealed-envelope sentinel

    // ── Bob's device reconnects and DRAINS (owner-gated). Gets opaque items.
    const bob = await makeDevice(host, bobNet);
    const drained = await dataOf(bob.invoke(host.agent.address, 'inbox.drain'));
    expect(drained.ok).toBe(true);
    expect(drained.items).toHaveLength(2);
    // M1 digest — ONE contentless summary for the batch.
    expect(drained.digest).toEqual({ count: 2, topics: ['dm'] });

    // ── Only Bob (the key-holder) can open. NO loss — both messages recovered.
    const opened = drained.items.map((m) => open(m.sealed, bobSeal.privateKey));
    expect(opened).toContain(plaintext);
    expect(opened).toContain('and bring the folder');

    // ── The inbox is empty after drain (drained, not duplicated).
    const after = await dataOf(bob.invoke(host.agent.address, 'inbox.count'));
    expect(after).toEqual({ ok: true, count: 0 });
  }, 20_000);

  it('DENY: a non-owner cannot drain (opaque forbidden, mailbox untouched)', async () => {
    const bobNet  = await AgentIdentity.generate(new VaultMemory());
    const bobSeal = generateKeypair();
    const host = await startCompanionNode({
      identityVault: new VaultMemory(), gate: false,
      inbox: true, inboxOwnerPubKey: bobNet.pubKey, inboxStore: new MemorySealedInboxStore(),
    });
    cleanups.push(() => host.stop());

    const ann = await makeDevice(host);   // Ann is NOT the owner
    await dataOf(ann.invoke(host.agent.address, 'inbox.deposit',
      { sealed: seal('secret', [bobSeal.publicKey]) }));

    const stolen = await dataOf(ann.invoke(host.agent.address, 'inbox.drain'));
    expect(stolen).toEqual({ ok: false, error: 'forbidden' });
    const probe = await dataOf(ann.invoke(host.agent.address, 'inbox.count'));
    expect(probe).toEqual({ ok: false, error: 'forbidden' });

    // Owner can still drain — the mailbox was untouched by the theft attempt.
    const bob = await makeDevice(host, bobNet);
    const drained = await dataOf(bob.invoke(host.agent.address, 'inbox.drain'));
    expect(drained.items).toHaveLength(1);
  }, 20_000);

  it('SEALED-ONLY: a plaintext deposit is refused (deny-by-default)', async () => {
    const bobNet = await AgentIdentity.generate(new VaultMemory());
    const host = await startCompanionNode({
      identityVault: new VaultMemory(), gate: false,
      inbox: true, inboxOwnerPubKey: bobNet.pubKey, inboxStore: new MemorySealedInboxStore(),
    });
    cleanups.push(() => host.stop());

    const ann = await makeDevice(host);
    const res = await dataOf(ann.invoke(host.agent.address, 'inbox.deposit',
      { sealed: 'this is raw plaintext, not sealed' }));
    expect(res).toEqual({ ok: false, error: 'not-sealed' });
    expect(await host.inbox.count(bobNet.pubKey)).toBe(0);
  }, 20_000);
});

describe('companion-node M2 — durable persistence (beyond the relay-queue TTL)', () => {
  it('a file-backed inbox survives a fresh store instance (node restart)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onderling-inbox-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'sealed-inbox.json');
    const bobSeal = generateKeypair();

    // Deposit through one inbox instance…
    const inboxA = createSealedInbox({ store: new FileSealedInboxStore(file) });
    await inboxA.deposit('bob', seal('durable hello', [bobSeal.publicKey]), { topic: 'dm' });

    // …a BRAND NEW instance (simulating a node restart) reads the same file.
    const inboxB = createSealedInbox({ store: new FileSealedInboxStore(file) });
    expect(await inboxB.count('bob')).toBe(1);
    const { items, digest } = await inboxB.drain('bob');
    expect(digest).toEqual({ count: 1, topics: ['dm'] });
    expect(open(items[0].sealed, bobSeal.privateKey)).toBe('durable hello');
    expect(await inboxB.count('bob')).toBe(0);
  });

  it('buildDrainDigest is a contentless count + topic summary', () => {
    const d = buildDrainDigest([{ topic: 'dm' }, { topic: 'dm' }, { topic: 'alerts' }, {}]);
    expect(d).toEqual({ count: 4, topics: ['alerts', 'dm'] });
  });
});
