// Step-1 identity substrate (create path): createRealHouseholdAgent stands up ONE
// owner root and derives the default-profile (chat) identity from it — the identity
// the feedback no-login pseudonym uses. Custody: the root SEED lives behind the key
// door (here the vault-backed fallback over the injected VaultMemory); the 24-word
// phrase is NEVER persisted — it exists on the reveal screen and in the user's hands.
// See plans/NOTE-identity-profiles-and-portability.md + ownerRootCustody.js.
import { describe, it, expect } from 'vitest';
import { VaultMemory, ROOT_SEED_VAULT_KEY } from '@onderling/vault';
import { Bootstrap, AgentIdentity } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const derivedDefaultPubKey = async (phrase) =>
  (await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default'), new VaultMemory())).pubKey;

describe('identity step-1 — owner root → default-profile chat identity', () => {
  it('persists the root SEED behind the key door — and no phrase at rest', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault });

    expect(await ownerRootVault.has(ROOT_SEED_VAULT_KEY)).toBe(true);   // the door holds the seed
    expect(await ownerRootVault.has('owner-phrase')).toBe(false);       // the phrase is not at rest

    // the chat agent's identity (= the feedback pseudonym) is the default-profile derivation
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    expect(mnemonic.trim().split(/\s+/).length).toBe(24);
    expect(a.sa.agent.identity.pubKey).toBe(await derivedDefaultPubKey(mnemonic));
  });

  it('the chat vault is SEALED at rest: the backing holds no plaintext seed', async () => {
    const chatVault = new VaultMemory();                             // the BACKING the boot seals
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault });
    const raw = await chatVault.get('agent-privkey');
    expect(typeof raw).toBe('string');
    expect(raw.startsWith('enc1:')).toBe(true);                      // sealed, not the seed itself
    expect(a.sa.agent.identity.pubKey).toBeTruthy();                 // …and the boot could still read it
  });

  it('is stable across a reboot with the same vaults', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ ownerRootVault, chatVault });
    const a2 = await createRealHouseholdAgent({ ownerRootVault, chatVault });   // "reboot"
    expect(a2.sa.agent.identity.pubKey).toBe(a1.sa.agent.identity.pubKey);
  });

  it('a pre-cutover install (cleartext phrase in the vault) is adopted: same identity, phrase removed', async () => {
    const first = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ ownerRootVault: first, chatVault: new VaultMemory() });
    const { mnemonic } = await a1.callSkill('household', 'revealOwnerPhrase', {});

    // "old install": the phrase sits cleartext where the pre-cutover code kept it
    const legacy = new VaultMemory();
    await legacy.set('owner-phrase', mnemonic);
    const a2 = await createRealHouseholdAgent({ ownerRootVault: legacy, chatVault: new VaultMemory() });

    expect(a2.sa.agent.identity.pubKey).toBe(a1.sa.agent.identity.pubKey);  // identity kept
    expect(await legacy.has('owner-phrase')).toBe(false);                   // migrated off rest
    expect(await legacy.has(ROOT_SEED_VAULT_KEY)).toBe(true);
  });
});

describe('identity step-1b — owner-root reveal/restore host skills', () => {
  it('revealOwnerPhrase re-renders the phrase from the in-memory root (nothing read from rest)', async () => {
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault: new VaultMemory() });
    const res = await a.callSkill('household', 'revealOwnerPhrase', {});
    expect(typeof res.mnemonic).toBe('string');
    expect(res.mnemonic.trim().split(/\s+/).length).toBe(24);
    expect(await ownerRootVault.has('owner-phrase')).toBe(false);
  });

  it('restoreOwnerPhrase installs a new root + re-derives the default profile into the chat vault', async () => {
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ ownerRootVault, chatVault });

    const { mnemonic } = Bootstrap.create();                       // a DIFFERENT phrase to restore
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    expect(res).toMatchObject({ ok: true, reloadRequired: true });

    // the key door now holds the restored seed; the phrase stays off rest; a reboot picks it up
    expect(await ownerRootVault.has('owner-phrase')).toBe(false);
    const expected = (await AgentIdentity.fromSeed(
      Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('default'), new VaultMemory())).pubKey;
    const rebooted = await createRealHouseholdAgent({ ownerRootVault, chatVault });   // reboot picks it up
    expect(rebooted.sa.agent.identity.pubKey).toBe(expected);
  });

  it('restoreOwnerPhrase rejects an invalid phrase', async () => {
    const a = await createRealHouseholdAgent({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic: 'not a real phrase' });
    expect(res).toMatchObject({ ok: false, error: 'invalid-phrase' });
  });
});
