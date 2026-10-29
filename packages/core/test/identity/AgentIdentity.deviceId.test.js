/**
 * AgentIdentity deviceId — + Phase 33.1 (2026-05-06).
 *
 * Verifies the install-scoped deviceId introduced in Phase 33.1:
 *
 * - Each AgentIdentity has a deviceId — a UUIDv4 string persisted in
 *   the vault under `agent-device-id`.
 * - It is FRESH per install — restoring the same mnemonic onto a
 *   different vault yields a DIFFERENT deviceId (same stableId).
 * - It is STABLE within an install — `restore()` returns the same
 *   value as the `generate()` / `fromMnemonic()` that initialised it.
 * - It is NOT touched by re-construction — the vault's stored value
 *   is the source of truth.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { generateMnemonic } from '../../src/identity/Mnemonic.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('AgentIdentity — Phase 33.1 per-install deviceId', () => {
  it('generate() lazy-inits a UUIDv4 deviceId in the vault', async () => {
    const vault = new VaultMemory();
    const id = await AgentIdentity.generate(vault);
    expect(typeof id.deviceId).toBe('string');
    expect(id.deviceId).toMatch(UUID_V4);
    const stored = await vault.get('agent-device-id');
    expect(stored).toBe(id.deviceId);
  });

  it('restore() returns the same deviceId that generate() persisted', async () => {
    const vault = new VaultMemory();
    const idA = await AgentIdentity.generate(vault);
    const idB = await AgentIdentity.restore(vault);
    expect(idB.deviceId).toBe(idA.deviceId);
  });

  it('two installs of the same mnemonic produce DIFFERENT deviceIds (and the same stableId)', async () => {
    const phrase = generateMnemonic();
    const idA = await AgentIdentity.fromMnemonic(phrase, new VaultMemory());
    const idB = await AgentIdentity.fromMnemonic(phrase, new VaultMemory());
    expect(idA.deviceId).not.toBe(idB.deviceId);
    expect(idA.stableId).toBe(idB.stableId);   // Phase 32 still holds
  });

  it('back-compat: a legacy vault without `agent-device-id` lazy-inits on first read', async () => {
    // Simulate a V1/V2 vault: agent-privkey already set, no device id.
    const vault = new VaultMemory();
    await AgentIdentity.generate(vault);
    await vault.delete('agent-device-id');

    const restored = await AgentIdentity.restore(vault);
    expect(restored.deviceId).toMatch(UUID_V4);
    const stored = await vault.get('agent-device-id');
    expect(stored).toBe(restored.deviceId);
  });
});
