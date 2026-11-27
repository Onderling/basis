/**
 * RESTORING A DEVICE FROM ITS OWN PHRASE. On a phone that already is this person, "Restore now" failed with the raw line
 * "VaultEncrypted: decryption failed for agent-stable-id" (a walk, 2026-11-27), while another person's phrase worked.
 * The vault's sentinel is bound to the ROOT's fingerprint: another phrase is another root, so the vault starts clean;
 * the same phrase keeps the sentinel, but the restore enrols a NEW device id and so seals under a NEW at-rest key, and
 * every entry sealed under the old one no longer opens. Those entries are unreadable either way; they go, the restore
 * stands, and what the restore wrote reads back.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { Bootstrap, AgentIdentity } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { restoreOwnerRoot } from '../src/core/agent/ownerRootRestore.js';

describe('restoring a device from its own phrase', () => {
  it('a second restore with the same phrase on the same device succeeds', async () => {
    const PHRASE = Bootstrap.create().mnemonic;
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const first = await restoreOwnerRoot({ mnemonic: PHRASE, rootKeyStore, chatVault, markerVault: ownerRootVault });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const again = await restoreOwnerRoot({ mnemonic: PHRASE, rootKeyStore, chatVault, markerVault: ownerRootVault });
    expect(again.ok, `the own phrase did not restore: ${JSON.stringify(again)}`).toBe(true);
    expect(again.deviceId, 'a restore enrols as a new device').not.toBe(first.deviceId);
  });

  it('through the app: restore its own phrase, then the next start boots on the same stores', async () => {
    const ownerRootVault = new VaultMemory(); const chatVault = new VaultMemory(); const hostVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault });
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    expect(mnemonic, 'the device shows its own phrase').toBeTruthy();
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    expect(res, 'the restore of its own phrase').toMatchObject({ ok: true, reloadRequired: true });
    let rebooted = null; let err = null;
    try { rebooted = await createRealHouseholdAgent({ ownerRootVault, chatVault, hostVault }); } catch (e) { err = e; }
    expect(err?.message ?? null, 'the next start did not boot').toBe(null);
    const expected = (await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'), new VaultMemory())).pubKey;
    expect(rebooted.sa.agent.identity.pubKey, 'the same person after the restart').toBe(expected);
  });
});
