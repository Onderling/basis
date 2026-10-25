/**
 * "A post matches what I offer" is judged on MY device against MY truth: the drivers of kind 'offering' of the self I
 * am in that circle (a persona's circle is the persona's), never the roster's member row (no shell writes that list
 * any more). A local source the agent hands to pinboard — reachable by no op and no wire.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { pinboardManifest } from '../../pinboard/manifest.js';

const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
const score = (a, args) => a.callSkill('pinboard', 'scorePostRelevance', { text: 'iemand?', ...args });

describe('a post matched against my own offerings', () => {
  it('the default\'s offering matches a post outside any persona\'s circle', async () => {
    const a = await boot();
    expect((await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin,snoeien', categoryId: 'tuin' })).ok).toBe(true);
    expect((await score(a, { categoryId: 'tuin' }))?.matched).toBe(true);
    expect((await score(a, { tags: ['snoeien'] }))?.matched).toBe(true);
    expect((await score(a, { categoryId: 'vervoer' }))?.matched).toBe(false);
  }, 60_000);

  it('the matcher never sees a driver the circle\'s self does not hold (a new persona holds its own offerings only; the default never holds a persona\'s)', async () => {
    const a = await boot();
    const { id } = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    await a.callSkill('agents', 'setProfileCircleMembership', { id, circleId: 'kantoor', handle: 'w', address: a.persona(id).circleAddressFor('kantoor') });
    await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin', categoryId: 'tuin' });
    await a.callSkill('agents', 'setProfileDriver', { id, key: 'fiets', kind: 'offering', text: 'Fietsen maken', tags: 'fiets', categoryId: 'vervoer' });
    expect((await score(a, { circleId: 'kantoor', categoryId: 'vervoer' }))?.matched, 'Werk\'s own offering, in Werk\'s circle').toBe(true);
    // a NEW persona does not take the general offerings unless it was asked and said yes (the new-persona wizard, default
    // no) — so the general 'tuin' is not Werk's; and what never happens either way is the reverse
    expect((await score(a, { circleId: 'kantoor', categoryId: 'tuin' }))?.matched, 'a new persona does not inherit the general offering').toBe(false);
    expect((await score(a, { categoryId: 'vervoer' }))?.matched, 'Werk\'s offering is not the default\'s').toBe(false);
  }, 60_000);

  it('a persona created with "yes, my offerings too" holds the general offering as its own inherited one', async () => {
    const a = await boot();
    const { id } = await a.callSkill('agents', 'createProfile', { name: 'Buurt', properties: JSON.stringify({ '_inherit.offering': { mode: 'own', value: true } }) });
    await a.callSkill('agents', 'setProfileCircleMembership', { id, circleId: 'straat', handle: 'b', address: a.persona(id).circleAddressFor('straat') });
    await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin', categoryId: 'tuin' });
    expect((await score(a, { circleId: 'straat', categoryId: 'tuin' }))?.matched).toBe(true);
    const drivers = (await a.callSkill('agents', 'getProfileDrivers', { id }))?.drivers ?? {};
    expect(Object.keys(drivers)).toContain('tuin');
  }, 60_000);

  it('away (the person\'s one availability record) matches nothing; back, it matches again', async () => {
    let record = { holiday: { active: true, until: null } };
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), availability: async () => record });
    await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin', categoryId: 'tuin' });
    expect((await score(a, { categoryId: 'tuin' }))?.matched, 'away').toBe(false);
    record = { holiday: { active: false } };
    expect((await score(a, { categoryId: 'tuin' }))?.matched, 'back').toBe(true);
  }, 60_000);

  it('the SOURCE (the drivers it reads) is returned by no op — the verdict is, by one op, local-only (scorePostRelevance refuses a peer)', () => {
    const ids = (pinboardManifest.operations ?? []).map((o) => o.id);
    for (const gone of ['addMyOffering', 'removeMyOffering', 'setMyOfferings', 'myOfferings', 'myOfferingsFor']) expect(ids, gone).not.toContain(gone);
  });
});
