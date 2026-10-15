/**
 * "A post matches what I offer" is judged on MY device against MY truth: the drivers of kind 'offering' of the self I
 * am in that circle (a persona's circle is the persona's), never the roster's member row (no shell writes that list
 * any more). A local source the agent hands to stoop — reachable by no op and no wire.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { stoopManifest } from '../../stoop/manifest.js';

const boot = () => createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
const score = (a, args) => a.callSkill('stoop', 'scorePostRelevance', { text: 'iemand?', ...args });

describe('a post matched against my own offerings', () => {
  it('the default\'s offering matches a post outside any persona\'s circle', async () => {
    const a = await boot();
    expect((await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin,snoeien', categoryId: 'tuin' })).ok).toBe(true);
    expect((await score(a, { categoryId: 'tuin' }))?.layer1?.matched).toBe(true);
    expect((await score(a, { tags: ['snoeien'] }))?.layer1?.matched).toBe(true);
    expect((await score(a, { categoryId: 'vervoer' }))?.layer1?.matched).toBe(false);
  }, 60_000);

  it('the matcher never sees a driver the circle\'s self does not hold (a persona holds its own and what it inherits; the default never holds a persona\'s)', async () => {
    const a = await boot();
    const { id } = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    await a.callSkill('agents', 'setProfileCircleMembership', { id, circleId: 'kantoor', handle: 'w', address: a.persona(id).circleAddressFor('kantoor') });
    await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin', categoryId: 'tuin' });
    await a.callSkill('agents', 'setProfileDriver', { id, key: 'fiets', kind: 'offering', text: 'Fietsen maken', tags: 'fiets', categoryId: 'vervoer' });
    expect((await score(a, { circleId: 'kantoor', categoryId: 'vervoer' }))?.layer1?.matched, 'Werk\'s own offering, in Werk\'s circle').toBe(true);
    // a persona follows the general persona unless it says otherwise (the persona arc: copy = inherit) — so Werk holds
    // the general offering too, as ITS OWN inherited one; what never happens is the reverse
    expect((await score(a, { circleId: 'kantoor', categoryId: 'tuin' }))?.layer1?.matched, 'Werk inherits the general offering').toBe(true);
    expect((await score(a, { categoryId: 'vervoer' }))?.layer1?.matched, 'Werk\'s offering is not the default\'s').toBe(false);
  }, 60_000);

  it('away (the person\'s one availability record) matches nothing; back, it matches again', async () => {
    let record = { holiday: { active: true, until: null } };
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), availability: async () => record });
    await a.callSkill('agents', 'setProfileDriver', { id: 'default', key: 'tuin', kind: 'offering', text: 'Tuinieren', tags: 'tuin', categoryId: 'tuin' });
    expect((await score(a, { categoryId: 'tuin' }))?.layer1?.matched, 'away').toBe(false);
    record = { holiday: { active: false } };
    expect((await score(a, { categoryId: 'tuin' }))?.layer1?.matched, 'back').toBe(true);
  }, 60_000);

  it('the source is reachable by no op and no wire — no manifest declares it', () => {
    const ids = (stoopManifest.operations ?? []).map((o) => o.id);
    for (const gone of ['addMyOffering', 'removeMyOffering', 'setMyOfferings', 'myOfferings', 'myOfferingsFor']) expect(ids, gone).not.toContain(gone);
  });
});
