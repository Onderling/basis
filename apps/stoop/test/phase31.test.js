/**
 * Stoop — Phase 31 tests.
 *
 * Mid-flight identity swap on restore.  Verifies:
 *   - core.Agent.swapIdentity replaces the running keypair without
 *     restart and emits 'self-swapped'.
 *   - restoreFromMnemonic skill calls swapIdentity end-to-end.
 *   - Post-swap whoAmI returns the new pubKey + stableId.
 *   - Phase 32 deterministic stableId combined with Phase 31 swap:
 *     after restoring on a 2nd device, stableId matches the original.
 *   - Pre-swap items (posts authored by the old identity) remain
 *     readable via the bundle's itemStore (they're addressBy webid,
 *     not pubKey).
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, generateMnemonic, mnemonicToSeed } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import nacl from 'tweetnacl';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle(vault) {
  const id = vault
    ? await AgentIdentity.generate(vault)
    : await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return { bundle, id };
}

function pubKeyFromMnemonic(mnemonic) {
  const seed = mnemonicToSeed(mnemonic);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return Buffer.from(kp.publicKey).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('Stoop V2.5 Phase 31.1 — Agent.swapIdentity (core)', () => {
  it('replaces the running keypair + emits self-swapped', async () => {
    const { bundle } = await buildBundle();
    const oldPubKey = bundle.agent.pubKey;
    const phrase = generateMnemonic();

    // Build a fresh AgentIdentity from a different vault/seed.
    const otherVault = new VaultMemory();
    const newId = await AgentIdentity.fromMnemonic(phrase, otherVault);
    expect(newId.pubKey).not.toBe(oldPubKey);

    const events = [];
    bundle.agent.on('self-swapped', (e) => events.push(e));

    const r = bundle.agent.swapIdentity(newId);
    expect(r.oldPubKey).toBe(oldPubKey);
    expect(r.newPubKey).toBe(newId.pubKey);
    expect(bundle.agent.pubKey).toBe(newId.pubKey);
    expect(bundle.agent.identity.stableId).toBe(newId.stableId);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ oldPubKey, newPubKey: newId.pubKey });
  });

  it('same-pubKey swap is a no-op (no event emitted)', async () => {
    const { bundle } = await buildBundle();
    const events = [];
    bundle.agent.on('self-swapped', (e) => events.push(e));
    bundle.agent.swapIdentity(bundle.agent.identity);
    expect(events).toHaveLength(0);
  });

  it('rejects bad inputs', async () => {
    const { bundle } = await buildBundle();
    expect(() => bundle.agent.swapIdentity(null)).toThrow();
    expect(() => bundle.agent.swapIdentity({})).toThrow();
  });
});

describe('Stoop V2.5 Phase 31.2 — restoreFromMnemonic mid-flight swap', () => {
  it('mid-flight: agent.pubKey changes without restart', async () => {
    const { bundle } = await buildBundle();
    const oldPubKey = bundle.agent.pubKey;
    const phrase = generateMnemonic();

    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });
    expect(r.ok).toBe(true);
    expect(r.newPubKey).toBe(pubKeyFromMnemonic(phrase));
    expect(r.newPubKey).not.toBe(oldPubKey);
    expect(bundle.agent.pubKey).toBe(r.newPubKey);
  });

  it('mid-flight: whoAmI reports new pubKey + new stableId post-swap', async () => {
    const { bundle } = await buildBundle();
    const beforeMe = await callSkill(bundle.agent, 'whoAmI', {});
    const phrase = generateMnemonic();

    await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });

    const afterMe = await callSkill(bundle.agent, 'whoAmI', {});
    expect(afterMe.pubKey).toBe(pubKeyFromMnemonic(phrase));
    expect(afterMe.pubKey).not.toBe(beforeMe.pubKey);
    expect(afterMe.stableId).toBeTruthy();
    expect(afterMe.stableId).not.toBe(beforeMe.stableId);
  });

  it('mid-flight + Phase 32 deterministic stableId: restoring on a 2nd bundle yields same stableId as the original', async () => {
    const phrase = generateMnemonic();

    // Original device sets up under the mnemonic-derived identity.
    const vaultOriginal = new VaultMemory();
    const originalId = await AgentIdentity.fromMnemonic(phrase, vaultOriginal);

    // Different device: a random-identity bundle, then restore via
    // mnemonic mid-flight.
    const { bundle } = await buildBundle();
    expect(bundle.agent.identity.stableId).not.toBe(originalId.stableId);

    await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });

    expect(bundle.agent.pubKey).toBe(originalId.pubKey);
    expect(bundle.agent.identity.stableId).toBe(originalId.stableId);
  });

  it('pre-swap items remain readable post-swap (state lives in itemStore, not bound to pubKey)', async () => {
    const { bundle } = await buildBundle();
    // Author a post under the old identity.
    const post = await callSkill(bundle.agent, 'postRequest', {
      text: 'Pre-swap post', kind: 'ask',
    });
    expect(post.requestId).toBeTruthy();

    const phrase = generateMnemonic();
    await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });

    // The post is still in the bundle's itemStore.
    const r = await callSkill(bundle.agent, 'listOpen', {});
    expect(r.items.some(i => i.id === post.requestId)).toBe(true);
  });

  it('rejects without confirm: true', async () => {
    const { bundle } = await buildBundle();
    const phrase = generateMnemonic();
    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase });
    expect(r.error).toContain('confirm');
    // Old identity unchanged.
    expect(bundle.agent.pubKey).not.toBe(pubKeyFromMnemonic(phrase));
  });

  it('rejects invalid mnemonic without swapping', async () => {
    const { bundle } = await buildBundle();
    const oldPubKey = bundle.agent.pubKey;
    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: 'garbage', confirm: true });
    expect(r.error).toBe('invalid-mnemonic');
    expect(bundle.agent.pubKey).toBe(oldPubKey);
  });
});
