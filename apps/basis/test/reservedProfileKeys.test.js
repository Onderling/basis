/**
 * THE REGISTRY'S OWN KEYS ARE NOT A PERSON'S TO SET. `setProfileProperty` (and `setProfileDriver`) wrote any key, so
 * one call with `deviceDelegations` replaced a profile's whole device-record map. The ops now refuse the registry's
 * machine keys — device records, circle memberships, owned nodes, the `_inherit.` markers — with `reserved-key`; a
 * person's own keys (a place, a picture, the app's own migration markers) are set as before.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe("the registry's own keys", () => {
  let agent;
  afterAll(async () => { await agent?.shutdown?.(); });

  it('are refused by the property ops; a person\'s own key still lands', async () => {
    agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) });
    const before = JSON.stringify(await agent.deviceRecordsOf('default'));
    for (const key of ['deviceDelegations', 'circleMemberships', 'ownedNodes', '_inherit.offering']) {
      const r = await agent.callSkill('agents', 'setProfileProperty', { id: 'default', key, value: 'x' });
      expect(r, key).toMatchObject({ ok: false, reason: 'reserved-key' });
      const d = await agent.callSkill('agents', 'setProfileDriver', { id: 'default', key, kind: 'offering', text: 'x' });
      expect(d, `driver ${key}`).toMatchObject({ ok: false, reason: 'reserved-key' });
    }
    expect(JSON.stringify(await agent.deviceRecordsOf('default')), 'the device records are untouched').toBe(before);
    expect((await agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'location', value: 'Utrecht' }))?.ok).toBe(true);
    expect((await agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: '_migrations.location', value: 'done' }))?.ok, 'the app\'s own markers are not the registry\'s').toBe(true);
  }, 60_000);
});
