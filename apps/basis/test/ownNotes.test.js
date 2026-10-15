/**
 * A person's own notes (of no circle) are `note` items in their OWN store — the own-devices scope, carried to their
 * other devices and never to a circle's members — reached by the same generic note ops a circle's notes use, with the
 * own scope named as the circle. Vandaag's notes block shows them beside the circles' notes, untagged by a circle.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../src/v2/grantsManifest.js';
import { materializeScreen } from '../src/v2/userScreenBlocks.js';

const op = (atom) => encodeGenericOpId('household', atom, 'note');

describe("a person's own notes", () => {
  it('land in the own store, and only there — made from the "+" they carry the DEFAULT\'s by, so they ride the default\'s lane (a Werk page riding Werk\'s lane waits for the persona picker)', async () => {
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'sleutel bij de buren' });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('note');
    expect(stored.map((n) => n.body)).toEqual(['sleutel bij de buren']);
    // never a household circle store named after the scope
    expect(a.householdService?.stores?.has?.(OWN_DEVICES_SCOPE) ?? false).toBe(false);
    const listed = await a.callSkill('household', op('list'), { circleId: OWN_DEVICES_SCOPE });
    expect((listed?.items ?? []).map((i) => i.text)).toEqual(['sleutel bij de buren']);
  });

  it('show on a notes block beside the circles\' notes, with no circle', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: memoryDataSource() }) });
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'eigen briefje' });
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'n', type: 'notes', config: {} }] },
      hostOps: { callSkill: (app, o, g) => a.callSkill(app, o, g), circles: [] },
    });
    expect(block.content.items.map((r) => [r.label, r.circleId])).toEqual([['eigen briefje', null]]);
  });
});

describe("a person's own notes are the person's — no door reaches them", () => {
  const boot = async (ds) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });

  it('a door\'s caller (a screen, a bot\'s person) naming the own scope — or a persona\'s own lane — lands nothing there and lists nothing from it', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'van mij' });
    await a.setDoorCaller('door-person', 'admin');
    for (const circleId of [OWN_DEVICES_SCOPE, `${OWN_DEVICES_SCOPE}:p-werk`]) {
      // the branch, named: an admitted door caller's add SUCCEEDS — in the household's own circle, because the waist
      // does not follow a circle a door names; it never lands in the own store
      const made = await a.callSkill('household', op('add'), { circleId, body: 'van de deur' }, { caller: 'door-person', threadId: 'door-person', via: 'screen' });
      expect(made?.ok, `the door's add ran, pinned elsewhere (${circleId})`).toBe(true);
      const listed = await a.callSkill('household', op('list'), { circleId }, { caller: 'door-person', threadId: 'door-person', via: 'screen' });
      expect(JSON.stringify(listed ?? {}), `a door never reads the own store (${circleId})`).not.toContain('van mij');
    }
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('note');
    expect(stored.map((n) => n.body), 'only the person\'s own note is there').toEqual(['van mij']);
  });

  it('a circle door\'s caller naming the own scope lands in that circle, never the own store', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    await a.setDoorCaller('member', 'admin');
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'via de kring' }, { caller: 'member', threadId: 'member', doorCircleId: 'circle-x', doorActor: 'member' });
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).length).toBe(0);
  });

  it('even the device itself cannot name a persona\'s own LANE as a circle — the own store is reached by the scope only', async () => {
    const a = await boot(memoryDataSource());
    const r = await a.callSkill('household', op('add'), { circleId: `${OWN_DEVICES_SCOPE}:p-werk`, body: 'x' });
    expect(r?.ok).toBe(false);
    expect(a.householdService?.stores?.has?.(`${OWN_DEVICES_SCOPE}:p-werk`) ?? false).toBe(false);
  });
});

describe("an own item made AS a persona (the waist's actAs)", () => {
  it('a note made as the persona carries its webid, so they ride its own lane; a self not held here is refused', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(made.id).chatId.pubKey;
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'werkbriefje' }, { actAs: werk });
    const note = (await createOwnDevicesStore({ dataSource: ds }).listByType('note')).find((n) => n.body === 'werkbriefje');
    expect(note?.createdBy).toBe(werk);
    // a door's caller naming a self of this device as actAs: refused (a door names who acts itself)
    await a.setDoorCaller('door-person', 'admin');
    const viaDoor = await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'deur-als-werk' }, { caller: 'door-person', threadId: 'door-person', actAs: werk });
    expect(viaDoor?.ok, 'a door caller cannot act as a self of this device').toBe(false);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).some((n) => n.body === 'deur-als-werk')).toBe(false);
    const r = await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'x' }, { actAs: 'not-a-self-of-mine' });
    expect(r?.ok).toBe(false);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).some((n) => n.body === 'x')).toBe(false);
  });
});
