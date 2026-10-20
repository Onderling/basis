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

describe("a person's own note can be changed and removed (Vandaag's rows open the sheet pre-filled)", () => {
  const boot = async (ds) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });

  it('update changes the text in the own store; remove takes it out', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    const made = await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'melk' });
    const id = made?.item?.id ?? (await createOwnDevicesStore({ dataSource: ds }).listByType('note'))[0]?.id;
    const changed = await a.callSkill('household', op('update'), { circleId: OWN_DEVICES_SCOPE, id, body: 'melk en brood' });
    expect(changed?.ok, JSON.stringify(changed)).not.toBe(false);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).map((n) => n.body)).toEqual(['melk en brood']);
    const gone = await a.callSkill('household', op('remove'), { circleId: OWN_DEVICES_SCOPE, id });
    expect(gone?.ok, JSON.stringify(gone)).not.toBe(false);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).length).toBe(0);
  });

  it("a door's caller naming the own scope changes nothing there (update and remove)", async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'van mij' });
    const id = (await createOwnDevicesStore({ dataSource: ds }).listByType('note'))[0].id;
    await a.setDoorCaller('door-person', 'admin');
    const via = { caller: 'door-person', threadId: 'door-person', via: 'screen' };
    await a.callSkill('household', op('update'), { circleId: OWN_DEVICES_SCOPE, id, body: 'overschreven' }, via).catch(() => null);
    await a.callSkill('household', op('remove'), { circleId: OWN_DEVICES_SCOPE, id }, via).catch(() => null);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).map((n) => n.body)).toEqual(['van mij']);
  });
});

describe('the note noun declares `update` — one contract for a circle and for the own store', () => {
  const boot = async (ds) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });

  it("a circle's note can be changed (the atom is declared, so the chat projection has it too)", async () => {
    const a = await boot(memoryDataSource());
    const made = await a.callSkill('household', op('add'), { body: 'vuilnis dinsdag' });
    const id = made?.result?.item?.id;
    const up = await a.callSkill('household', op('update'), { id, body: 'vuilnis woensdag' });
    expect(up?.ok, JSON.stringify(up)).toBe(true);
  });

  it('the own store answers only the atoms a noun declares — the same refusal a circle gives', async () => {
    const a = await boot(memoryDataSource());
    const r = await a.callSkill('household', encodeGenericOpId('household', 'update', 'contact'), { circleId: OWN_DEVICES_SCOPE, id: 'x' });
    expect(r?.ok).toBe(false);
    expect(r?.code).toBe('unimplemented');
  });
});

describe("an own row made AS a persona is changed AS that persona (the sheet passes its maker's self)", () => {
  it("the row names its maker self; the sheet's edit runs as it; as the general self it is refused", async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const { plusEditFor, plusSaveOp } = await import('../src/v2/vandaagPlus.js');
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(made.id).chatId.pubKey;
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'werkbriefje' }, { actAs: werk });
    const held = [{ id: 'default', webid: a.identity?.chat?.pubKey ?? 'me' }, { id: made.id, webid: werk }];
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'n', type: 'notes', config: {} }] },
      hostOps: { callSkill: (app, o, g) => a.callSkill(app, o, g), circles: [], selfSet: { on: ['default', made.id], held } },
    });
    const row = block.content.items.find((r) => r.label === 'werkbriefje');
    expect(row?.maker, 'the row names the self that made it').toBe(made.id);
    expect(plusEditFor({ ...row, maker: null }, 'note'), 'a maker not run here: read-only').toBe(null);
    const edit = plusEditFor(row, 'note');
    expect(edit?.asSelf).toBe(made.id);
    const save = plusSaveOp(edit.act.id, { body: 'werkbriefje (bijgewerkt)' }, { id: edit.id });
    const asGeneral = await a.callSkill(save.app, save.opId, save.args);
    expect(asGeneral?.ok, 'as the general self: not yours').toBe(false);
    const asMaker = await a.callSkill(save.app, save.opId, save.args, { actAs: werk });
    expect(asMaker?.ok, JSON.stringify(asMaker)).not.toBe(false);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('note')).map((n) => n.body)).toContain('werkbriefje (bijgewerkt)');
  });
});

