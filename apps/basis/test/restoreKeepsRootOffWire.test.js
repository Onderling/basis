/**
 * The owner root never becomes an everyday key, and no in-process agent's key is ever on a card.
 *
 * Found 2026-10-23: the restore wizard's second step (`pinboard.restoreFromMnemonic`) wrote the phrase's own bytes —
 * the owner ROOT secret — as the pinboard sub-agent's seed, and the default contact card carried the pinboard
 * sub-agent's pubKey. After a restore, every card this person handed out named the root's public key: the one key
 * that links every persona. Before a restore it named a key nobody routes to.
 *
 * Every vault the agent opens is handed in here (`vaultFor`), so a second boot over the same storage is the relaunch.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { Bootstrap, b64encode, DataPart } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { initialState, submitRestore } from '../src/core/wizards/restoreFromMnemonicState.js';
import { decodeContactCard } from '../src/v2/contactCardLink.js';

/** One device's storage: every vault the agent opens, by prefix, plus the owner-root and chat homes a shell hands in. */
function deviceStorage() {
  const vaults = new Map();
  const vaultFor = (prefix) => {
    if (!vaults.has(prefix)) vaults.set(prefix, new VaultMemory());
    return vaults.get(prefix);
  };
  const ownerRootVault = new VaultMemory();
  return {
    vaultFor, ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }),
    chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
  };
}

const boot = (device) => createRealHouseholdAgent({ seedHousehold: false, ...device });
const inProcess = (agent) => Object.values(agent.inProcessPubKeys()).filter(Boolean);

async function card(agent) {
  return decodeContactCard((await agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload);
}

describe('the restore wizard keeps the owner root off the wire', () => {
  it('after a restore, no in-process agent holds the root key, and the card names the chat identity',
    { timeout: 120_000 }, async () => {
      const original = await boot(deviceStorage());
      const phrase = (await original.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
      const rootPub = b64encode(Bootstrap.fromMnemonic(phrase).derivedPubKey());

      // A second device: the person types the phrase into the restore wizard, then the app reloads.
      const device = deviceStorage();
      const before = await boot(device);
      const state = await submitRestore({ state: { ...initialState(), mnemonic: phrase }, callSkill: before.callSkill });
      expect(state.submitError).toBe(null);
      expect(state.successResult?.ok).toBe(true);
      const agent = await boot(device);

      expect(inProcess(agent)).toHaveLength(5);
      expect(inProcess(agent)).not.toContain(rootPub);

      const chat = agent.sa.agent.identity;
      const c = await card(agent);
      expect(c.pubKey).toBe(chat.pubKey);
      expect(c.stableId).toBe(chat.stableId);
      expect(inProcess(agent)).not.toContain(c.pubKey);
      // …and the old second step cannot be reached through basis any more.
      expect((await agent.callSkill('pinboard', 'restoreFromMnemonic', { mnemonic: phrase, confirm: true }))?.error)
        .toBe('restore-with-owner-phrase');
    });

  it('a fresh profile\'s card already names the chat identity, never an in-process agent', { timeout: 120_000 }, async () => {
    const agent = await boot(deviceStorage());
    const c = await card(agent);
    expect(c.pubKey).toBe(agent.sa.agent.identity.pubKey);
    expect(inProcess(agent)).not.toContain(c.pubKey);
  });
});

describe('a device restored before the fix heals at the next boot', () => {
  it('an in-process agent whose seed IS the owner root gets a fresh seed, and the boot says so once',
    { timeout: 120_000 }, async () => {
      const device = deviceStorage();
      const first = await boot(device);
      const phrase = (await first.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
      const rootPub = b64encode(Bootstrap.fromMnemonic(phrase).derivedPubKey());
      // What the old wizard left behind: its second step, sent straight to the pinboard agent (basis now refuses it).
      await first.sa.agent.invoke(first.inProcessPubKeys().pinboard, 'restoreFromMnemonic', [DataPart({ mnemonic: phrase, confirm: true })]);
      expect(Object.values(first.inProcessPubKeys())).toContain(rootPub);

      const lines = [];
      const original = console.warn;
      console.warn = (...a) => { lines.push(a.map(String).join(' ')); };
      let second;
      try { second = await boot(device); } finally { console.warn = original; }

      expect(inProcess(second)).toHaveLength(5);
      expect(inProcess(second)).not.toContain(rootPub);
      expect(inProcess(second)).not.toContain(second.sa.agent.identity.pubKey);
      const said = lines.filter((l) => l.includes('owner-root key'));
      expect(said.length).toBe(1);
      expect(said[0]).not.toContain(rootPub);   // counts only — the key itself is never logged
    });
});
