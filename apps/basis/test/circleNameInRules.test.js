/**
 * A CIRCLE'S NAME LIVES IN ITS RULES DOC, and the one name read is the highest-version rules head that carries one.
 *
 * Measured 2026-11-28 over a real agent: a circle made as "Oud", then a rules change through the rules screen's own
 * path (rulesForSave over the head, editGroupRules) wrote a v2 head whose text was the circle's KEY; the name still
 * read "Oud" only because the read took the FIRST rules row. And a newer head with a new name never showed, for the
 * same reason. The recovery file's screen named a circle by its key (it read a name from a list of bare ids).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { rulesForSave } from '../src/v2/governanceDoors.js';

const boot = () => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
});
const nameOf = async (a, id) => (await a.callSkill('pinboard', 'listMyCircles', {}))?.names?.[id] ?? null;
const headsOf = async (a, id) => ((await a.callSkill('pinboard', 'listOpenRequests', { type: 'group-rules' }))?.items ?? [])
  .filter((x) => x?.source?.groupId === id);

describe('a circle\'s name lives in its rules doc', () => {
  it('the maker\'s rules doc carries the name', async () => {
    const a = await boot();
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'k1', name: 'Oud', rules: { text: 'Oud' } });
    const [head] = await headsOf(a, 'k1');
    expect(head?.source?.rules?.name).toBe('Oud');
    await a.shutdown?.();
  });

  it('a rules change through the rules screen\'s path keeps the name, and never writes the key as the name', async () => {
    const a = await boot();
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'k1', name: 'Oud', rules: { text: 'Oud' } });
    const got = await a.callSkill('pinboard', 'getGroupRules', { groupId: 'k1' });
    const head = got?.rules?.source?.rules ?? got?.doc ?? null;
    expect((await a.callSkill('pinboard', 'editGroupRules', { groupId: 'k1', rules: rulesForSave(head, { purpose: 'samen koken' }) }))?.version).toBe(2);
    const v2 = (await headsOf(a, 'k1')).find((h) => Number(h?.source?.version) === 2);
    expect(v2?.text, 'the newer head is named, not keyed').toBe('Oud');
    expect(await nameOf(a, 'k1')).toBe('Oud');
    await a.shutdown?.();
  });

  it('a newer head with a new name is the name (by version, not by which row came first)', async () => {
    const a = await boot();
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'k1', name: 'Oud', rules: { text: 'Oud' } });
    expect((await a.callSkill('pinboard', 'recordGroupRulesUpdate', { groupId: 'k1', rules: { name: 'Nieuw', text: 'x' }, version: 2 }))?.applied).toBe(true);
    expect(await nameOf(a, 'k1')).toBe('Nieuw');
    await a.shutdown?.();
  });

  it('a newer head WITHOUT a name never hides the name an older head carries', async () => {
    const a = await boot();
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'k1', name: 'Oud', rules: { text: 'Oud' } });
    await a.callSkill('pinboard', 'recordGroupRulesUpdate', { groupId: 'k1', rules: { text: 'x' }, version: 2 });
    expect(await nameOf(a, 'k1')).toBe('Oud');
    await a.shutdown?.();
  });

  it('the recovery file\'s screen names a circle by its name, never its key', async () => {
    const a = await boot();
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'k1', name: 'Oud', rules: { text: 'Oud' } });
    // the membership the app's create flow files (a bare createGroupV2 files none; the file lists from memberships)
    await a.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: 'k1', handle: 'me', address: 'relay:me-k1' });
    const listed = await a.callSkill('household', 'listRecoveryCircles', {});
    expect(listed?.circles?.find((c) => c.id === 'k1')?.name).toBe('Oud');
    await a.shutdown?.();
  });
});
