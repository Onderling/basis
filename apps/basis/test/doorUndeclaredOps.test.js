/**
 * A door's caller reaches DECLARED ops only. A door role widens WHICH declared ops a person reaches, never the set
 * itself — admin at a door is a person at a door, not the owner. An op no manifest declares (pinboard's
 * `scorePostRelevance`, which answers over the person's private offerings) is refused at the door's map, by name; the
 * device's own call (no door) still reaches it.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { opDeclared } from '../src/v2/manifestSources.js';

describe('a door reaches declared ops only', () => {
  it('the declared set: a declared op, a generic op over a declared noun; not an undeclared one', () => {
    expect(opDeclared('pinboard.listMyOfferings')).toBe(true);
    expect(opDeclared('household.__generic__:household:add:note')).toBe(true);
    expect(opDeclared('pinboard.scorePostRelevance')).toBe(false);
    expect(opDeclared('household.__generic__:household:add:nonsense')).toBe(false);
    expect(opDeclared('scorePostRelevance')).toBe(false);
    // a bare id: one declarer counts (as the door map reads it); since every op has one owner, the chores' listOpen does
    expect(opDeclared('addToList')).toBe(true);
    expect(opDeclared('listOpen')).toBe(true);
  });

  it('an admin at a door asking an undeclared op is refused by name; a declared op answers; the device itself still reaches it', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    await a.setDoorCaller('door-person', 'admin');
    const door = { caller: 'door-person', threadId: 'door-person' };
    const r = await a.callSkill('pinboard', 'scorePostRelevance', { text: 'x', categoryId: 'tuin' }, door);
    expect(r?.ok).toBe(false);
    expect(r?.refusal).toMatchObject({ layer: 'door-map', code: 'undeclared-op' });
    const declared = await a.callSkill('pinboard', 'listMyOfferings', {}, door);
    expect(declared?.refusal, JSON.stringify(declared)).toBeUndefined();
    const own = await a.callSkill('pinboard', 'scorePostRelevance', { text: 'x', categoryId: 'tuin' });
    expect(own?.refusal).toBeUndefined();
    expect(own).toHaveProperty('matched');
  }, 60_000);
});
