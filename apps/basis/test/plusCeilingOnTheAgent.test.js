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
import { createPlusDoor } from '../src/assistant/plusDoor.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

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

    // the "+" reads it AS the self, through the call both shells hand it (`callAs` on web, `plusAsSelf` on the phone:
    // the waist's actAs with the persona's webid), and is off for that persona only
    const webidOf = (id) => (id && id !== 'default' ? agent.persona(id).chatId.pubKey : null);
    const readAs = (id) => (app, opId, args) => { const actAs = webidOf(id); return actAs ? agent.callSkill(app, opId, args, { actAs }) : agent.callSkill(app, opId, args); };
    const door = createPlusDoor({ llm: null, t: (k) => k, lang: 'nl', threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }), threadId: 'own:me', readAs, circles: async () => [], ownListsOf: async () => [] });
    expect((await door.read('wat staat er vandaag?', { asSelf: werk })).done).toBe('circle.vandaag.plus_ceiling_off');
    expect((await door.read('wat staat er vandaag?', { asSelf: 'default' })).done ?? null).not.toBe('circle.vandaag.plus_ceiling_off');
  }, 60_000);
});
