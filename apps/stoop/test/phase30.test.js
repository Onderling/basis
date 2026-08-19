/**
 * Stoop V2 — Phase 30 tests.
 *
 *   30.1  validateMnemonicPhrase: valid mnemonic returns ok + pubKey;
 *         invalid returns error
 *   30.1  restoreFromMnemonic: writes seed to vault; returns new pubKey;
 *         requires confirm: true; clears stableId so the next restart
 *         issues a fresh one
 *   30.4  end-to-end: a fresh bundle booting from a vault that was
 *         written by restoreFromMnemonic uses the mnemonic's keypair
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

describe('Stoop V2 Phase 30.1 — validateMnemonicPhrase', () => {
  it('valid mnemonic returns ok + pubKey matching Bootstrap-derived key', async () => {
    const { bundle } = await buildBundle();
    const phrase = generateMnemonic();
    const r = await callSkill(bundle.agent, 'validateMnemonicPhrase', { mnemonic: phrase });
    expect(r.ok).toBe(true);
    expect(r.pubKey).toBe(pubKeyFromMnemonic(phrase));
  });

  it('invalid mnemonic rejected', async () => {
    const { bundle } = await buildBundle();
    const r = await callSkill(bundle.agent, 'validateMnemonicPhrase',
      { mnemonic: 'not a valid bip39 phrase at all here' });
    expect(r.error).toBe('invalid-mnemonic');
  });

  it('empty rejected', async () => {
    const { bundle } = await buildBundle();
    expect(await callSkill(bundle.agent, 'validateMnemonicPhrase', {}))
      .toEqual({ error: 'mnemonic required' });
  });
});

describe('Stoop V2 Phase 30.1 — restoreFromMnemonic', () => {
  it('requires confirm: true', async () => {
    const { bundle } = await buildBundle();
    const phrase = generateMnemonic();
    expect(await callSkill(bundle.agent, 'restoreFromMnemonic', { mnemonic: phrase }))
      .toEqual({ error: 'confirm: true required (destructive op)' });
  });

  it('rejects invalid mnemonic even with confirm', async () => {
    const { bundle } = await buildBundle();
    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: 'garbage', confirm: true });
    expect(r.error).toBe('invalid-mnemonic');
  });

  it('writes seed to vault + re-derives stableId from new seed; returns the new pubKey', async () => {
    const vault = new VaultMemory();
    const { bundle } = await buildBundle(vault);
    const phrase = generateMnemonic();

    // Sanity: vault has an existing seed before restore.
    const beforeKey = await vault.get('agent-privkey');
    expect(beforeKey).toBeTruthy();

    const r = await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });
    expect(r.ok).toBe(true);
    expect(r.newPubKey).toBe(pubKeyFromMnemonic(phrase));

    // Vault carries the new mnemonic-derived seed.
    const afterKey = await vault.get('agent-privkey');
    expect(afterKey).toBeTruthy();
    expect(afterKey).not.toBe(beforeKey);

    // Phase 31 + 32: restoreFromMnemonic immediately re-derives the
    // stableId from the new seed via AgentIdentity.restore (called
    // inside the swap path).  The vault now carries the
    // deterministic-from-seed stableId; it equals what
    // AgentIdentity.fromMnemonic(phrase) would produce on a fresh
    // device.
    const afterStableId = await vault.get('agent-stable-id');
    expect(afterStableId).toBeTruthy();
    const peerVault = new VaultMemory();
    const peerId = await AgentIdentity.fromMnemonic(phrase, peerVault);
    expect(afterStableId).toBe(peerId.stableId);
  });
});

describe('Stoop V2 Phase 30.4 — restored bundle adopts the mnemonic identity', () => {
  it('a fresh bundle constructed from the post-restore vault uses the mnemonic\'s keypair', async () => {
    // 1. Original bundle.
    const vault = new VaultMemory();
    const { bundle } = await buildBundle(vault);
    const phrase = generateMnemonic();
    await callSkill(bundle.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });

    // 2. Fresh AgentIdentity from the same vault — should adopt the
    //    mnemonic-derived keypair (AgentIdentity.restore reads
    //    `agent-privkey` from the vault).
    const restoredId = await AgentIdentity.restore(vault);
    expect(restoredId.pubKey).toBe(pubKeyFromMnemonic(phrase));

    // 3. Phase 32: stableId is now derived deterministically
    //    from the mnemonic-seed.  Restoring on a separate device
    //    (= a fresh vault) produces the SAME stableId.
    expect(restoredId.stableId).toBeTruthy();
    expect(typeof restoredId.stableId).toBe('string');
  });

  it('Phase 32: same mnemonic → same stableId on a separate fresh vault', async () => {
    const phrase = generateMnemonic();

    // Device A: write the mnemonic into a fresh vault.
    const vaultA = new VaultMemory();
    const { bundle: bundleA } = await buildBundle(vaultA);
    await callSkill(bundleA.agent, 'restoreFromMnemonic',
      { mnemonic: phrase, confirm: true });
    const idA = await AgentIdentity.restore(vaultA);

    // Device B: SEPARATE fresh vault, same mnemonic.
    const vaultB = new VaultMemory();
    const idB = await AgentIdentity.fromMnemonic(phrase, vaultB);

    // Same pubKey AND same stableId — the user is the same person
    // across devices for app-level state (mute / report / cache).
    expect(idB.pubKey).toBe(idA.pubKey);
    expect(idB.stableId).toBe(idA.stableId);
  });
});
