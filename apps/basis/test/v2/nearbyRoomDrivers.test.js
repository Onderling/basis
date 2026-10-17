/**
 * MATCHING IN THE ROOM AS THE ROOM SELF — an ask arriving in Nearby is weighed against THE ROOM SELF's effective drivers
 * (a persona's own, plus what it inherits — never the general persona's offerings when the persona said no), read on
 * this device and never sent; while the room asks who enters, against nothing. The shared-skills line shows that self's
 * offerings. A match is a notice to the person, never an answer by itself.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { createNearbyIdentity } from '../../src/v2/nearbyIdentity.js';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';

describe('matching in the room as the room self', () => {
  it('the room self\'s effective drivers — Werk\'s, never the general persona\'s offering Werk said no to; asking → none', async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    expect((await agent.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuinieren', kind: 'offering', text: 'tuinieren', tags: 'tuin' }))?.ok, 'the general persona offers gardening').toBe(true);
    const w = (await agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;   // new personas: offerings off (L306)
    expect((await agent.callSkill('agents', 'setProfileDriver', { id: w, key: 'fietsen', kind: 'offering', text: 'fietsband plakken', tags: 'fiets' }))?.ok, 'Werk offers bicycle repair').toBe(true);
    const callSkill = (app, op, args) => agent.callSkill(app, op, args);
    let room = { id: w, name: 'Werk' };
    const id = createNearbyIdentity({ callSkill, roomSelf: () => room });
    const asWerk = await id.getDrivers();
    const labels = Object.values(asWerk).map((d) => d?.text);
    expect(labels, `Werk's own offering: ${JSON.stringify(asWerk)}`).toContain('fietsband plakken');
    expect(labels, 'never the general persona\'s offering Werk said no to').not.toContain('tuinieren');
    expect(id.mySkills().map((s) => s.text), 'the shared-skills line: the room self\'s offerings').toEqual(['fietsband plakken']);
    room = { asking: true };
    expect(await id.getDrivers(), 'while the room asks: nothing').toEqual({});
    expect(id.mySkills()).toEqual([]);
    await agent.shutdown?.();
  }, 120_000);

  it('a match is a notice, never an answer by itself', async () => {
    const sent = [];
    let onAsk = null;
    const screen = createNearbyScreen({
      subscribeToAsks: (fn) => { onAsk = fn; return () => {}; },
      askChannel: { broadcastKind: async (...a) => { sent.push(a); return { sent: 1 }; } },
      getDrivers: async () => ({ fietsen: { kind: 'offering', label: 'fietsband plakken', tags: ['fiets'] } }),
      t: (k) => k,
    });
    screen.open();
    onAsk?.({ id: 'a1', text: 'wie kan mijn fietsband plakken?', tags: ['fiets'], from: 'stranger', ts: Date.now() });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent, 'nothing was said to the room').toEqual([]);
    screen.close();
  });
});
