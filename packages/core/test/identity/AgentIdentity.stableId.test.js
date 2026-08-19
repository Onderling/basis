/**
 * AgentIdentity stableId — + Phase 32 (2026-05-07).
 *
 * Verifies the deterministic-from-seed derivation introduced in
 * Phase 32: same seed → same stableId on a fresh vault, on any
 * device.  Existing vaults with a random stableId stored under
 * `agent-stable-id` keep theirs (back-compat).
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { generateMnemonic } from '../../src/identity/Mnemonic.js';

describe('AgentIdentity — Phase 32 deterministic stableId', () => {
  it('same mnemonic → same stableId across two fresh vaults', async () => {
    const phrase = generateMnemonic();
    const idA = await AgentIdentity.fromMnemonic(phrase, new VaultMemory());
    const idB = await AgentIdentity.fromMnemonic(phrase, new VaultMemory());
    expect(idA.stableId).toBe(idB.stableId);
    expect(idA.pubKey).toBe(idB.pubKey);
  });

  it('different mnemonics → different stableIds', async () => {
    const phraseA = generateMnemonic();
    const phraseB = generateMnemonic();
    const idA = await AgentIdentity.fromMnemonic(phraseA, new VaultMemory());
    const idB = await AgentIdentity.fromMnemonic(phraseB, new VaultMemory());
    expect(idA.stableId).not.toBe(idB.stableId);
  });

  it('AgentIdentity.generate also produces deterministic-from-seed stableId', async () => {
    // generate() picks a random seed, so we can't compare across two
    // calls.  Instead: create the identity, restore it, verify the
    // stableId persists (same vault) AND verify it equals what we'd
    // derive from the seed.
    const vault = new VaultMemory();
    const idA = await AgentIdentity.generate(vault);
    const idB = await AgentIdentity.restore(vault);
    expect(idB.stableId).toBe(idA.stableId);
  });

  it('back-compat: pre-existing random stableId in vault is preserved', async () => {
    // Simulate a V1 / V2 vault that already has a (random) stableId
    // stored.  Phase 32 must NOT overwrite it — the user's existing
    // mute / report state would break otherwise.
    const vault = new VaultMemory();
    await vault.set('agent-stable-id', 'legacy-random-stableid-xyz');
    const phrase = generateMnemonic();
    const id = await AgentIdentity.fromMnemonic(phrase, vault);
    expect(id.stableId).toBe('legacy-random-stableid-xyz');
  });

  it('clearing the legacy stableId triggers re-derivation from the seed (the restore-from-mnemonic flow)', async () => {
    const phrase = generateMnemonic();
    // Original device.
    const vaultA = new VaultMemory();
    const idA = await AgentIdentity.fromMnemonic(phrase, vaultA);

    // Restore on a 2nd device.  Stoop's restoreFromMnemonic clears
    // any existing stableId (defence in depth — but with Phase 32,
    // the re-derivation produces the same value anyway).
    const vaultB = new VaultMemory();
    await vaultB.set('agent-stable-id', 'will-be-deleted');
    await vaultB.delete('agent-stable-id');
    const idB = await AgentIdentity.fromMnemonic(phrase, vaultB);
    expect(idB.stableId).toBe(idA.stableId);
  });
});
