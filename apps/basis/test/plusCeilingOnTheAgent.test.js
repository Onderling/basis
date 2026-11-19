/**
 * How far the person's own "+" goes for a persona, kept on the real agent (ledger L977): set through its own op, read
 * back resolved (own, else the general persona's, else 3), and NOT settable through the person-facing property op (the
 * key is the registry's), so nothing the "+" may offer can change its own reach.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('the ceiling of the "+" on the real agent', () => {
  let agent;
  afterAll(async () => { await agent?.shutdown?.(); });

  it('set by its own op, read back resolved, refused by the property op', async () => {
    agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) });
    const get = async (id) => (await agent.callSkill('agents', 'getPlusCeiling', { id }))?.ceiling;
    expect(await get('default')).toBe(3);
    expect((await agent.callSkill('agents', 'setPlusCeiling', { id: 'default', ceiling: 1 }))?.ok).toBe(true);
    expect(await get('default')).toBe(1);
    // a persona with no word of its own takes the general persona's
    const made = await agent.callSkill('agents', 'createProfile', { name: 'Werk' });
    expect(made?.ok ?? made?.created, JSON.stringify(made)).toBeTruthy();
    const werk = made.id;
    expect(await get(werk)).toBe(1);
    expect((await agent.callSkill('agents', 'setPlusCeiling', { id: werk, ceiling: 0 }))?.ok).toBe(true);
    expect(await get(werk)).toBe(0);
    expect(await get('default')).toBe(1);
    // the property op may not set it: the key is the registry's
    const r = await agent.callSkill('agents', 'setProfileProperty', { id: werk, key: '_plus.ceiling', value: 3 });
    expect(r).toMatchObject({ ok: false, reason: 'reserved-key' });
    expect(await get(werk)).toBe(0);
  }, 60_000);
});
