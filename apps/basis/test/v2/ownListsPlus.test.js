/**
 * A PERSON'S OWN LISTS IN THE "+" THREAD. Their lists live in their own store, beside their own agenda (no new store),
 * reached by the lists ops with the own scope named as the circle. A list is the self's it was made AS (the "+"'s
 * ticked self: the waist's `actAs`), rides that self's own lane, and is only read with that self ticked. The "+" reads
 * a line against the ticked self's own lists FIRST with the same phrase table the box reads; a name both own and in a
 * circle asks with a card, 'mine' first; "nieuwe lijst <naam>" makes an own one. The thread answers a read of a list
 * with its entries, done and not done.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, isMirroredKind } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { plusLineOutcome, plusCircleOp, plusCardLabel, plusDoneLine, plusOwnLists } from '../../src/v2/vandaagPlus.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { listsGateRules } from '../../src/v2/circleGate.js';

const OWN = OWN_DEVICES_SCOPE;
const boot = async (ds, extra = {}) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }), ...extra });

describe("a person's own lists live in their own store", () => {
  it('made, added to, read and ticked with the own scope as the circle; never a household store named after the scope', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    const made = await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    expect((await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'boodschappen', text: 'melk' }))?.ok).toBe(true);
    expect((await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'Boodschappen', text: 'brood' }))?.ok).toBe(true);
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('list');
    expect(stored.map((l) => l.text)).toEqual(['Boodschappen']);
    expect(a.householdService?.stores?.has?.(OWN) ?? false, 'no household store named after the scope').toBe(false);
    const done = await a.callSkill('lists', 'markListItemDone', { circleId: OWN, list: 'Boodschappen', item: 'melk' });
    expect(done?.ok, JSON.stringify(done)).not.toBe(false);
    const read = await a.callSkill('lists', 'listEntries', { circleId: OWN, list: 'Boodschappen' });
    // the done one stays, marked (a bare agent words it by its key: the marked line's own words are the locale's)
    expect(read.items.map((i) => [i.done === true, i.label])).toEqual([[true, 'circle.lists.entry_done'], [false, 'brood']]);
  });

  it('the own Agenda is the calendar\'s: not one of the own lists', async () => {
    const a = await boot(memoryDataSource());
    await a.callSkill('calendar', 'listEvents', { circleId: OWN });                 // makes the own Agenda
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    const lists = await a.callSkill('lists', 'listLists', { circleId: OWN });
    expect(lists.items.map((l) => l.label)).toEqual(['Boodschappen']);
  });

  it("a persona's own LANE is not a place, and a door never reaches the own lists", async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    const lane = await a.callSkill('lists', 'createList', { circleId: `${OWN}:p-werk`, text: 'x' });
    expect(lane?.ok).toBe(false);
    await a.setDoorCaller('door-person', 'admin');
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'van de deur' }, { caller: 'door-person', threadId: 'door-person', via: 'screen' }).catch(() => null);
    expect((await createOwnDevicesStore({ dataSource: ds }).listByType('list')).length, 'nothing landed in the own store').toBe(0);
  });

  it('what the own lists write rides the items lane, a kind the person\'s history mirror keeps', () => {
    // an own list adds no entry kind: its rows are store items, carried as `items` statements on the own lane
    expect(isMirroredKind('items')).toBe(true);
  });
});

describe('an own list is the self it was made as', () => {
  it('a list made as a persona carries its key, and is read only with that persona ticked (never with the general self)', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const ds = memoryDataSource();
    const a = await boot(ds, { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const p = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(p.id).chatId.pubKey;
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Projecten' }, { actAs: werk });
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('list');
    expect(stored.find((l) => l.text === 'Projecten')?.createdBy).toBe(werk);
    const general = await a.callSkill('lists', 'listLists', { circleId: OWN });
    expect(general.items.map((l) => l.label), 'the general self does not see Werk\'s list').toEqual(['Boodschappen']);
    const asWerk = await a.callSkill('lists', 'listLists', { circleId: OWN }, { actAs: werk });
    expect(asWerk.items.map((l) => l.label), 'Werk sees only its own').toEqual(['Projecten']);
    const added = await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'Projecten', text: 'offerte' });
    expect(added?.ok, 'the general self cannot add to Werk\'s list').toBe(false);
  });
});

describe('the "+" reads the ticked self\'s own lists first', () => {
  const byOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
  const circle = (id, name, lists = []) => ({ id, name, lists, manifestsByOrigin: { lists: byOrigin.lists, tasks: byOrigin.tasks } });
  const SHOP = { name: 'Boodschappen', kind: 'list' };
  const own = (lists) => ({ name: 'mine', lists });

  it('an own list of that name, and no circle holding one: it runs there at once', () => {
    const r = plusLineOutcome('zet melk op mijn boodschappen', { circles: [circle('c1', 'Thuis', [])], own: own([SHOP]) });
    expect(r).toMatchObject({ kind: 'circle', atOnce: true, circleId: OWN, command: { appOrigin: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: OWN } } });
  });

  it('a name both own and in a circle: the card asks, mine first', () => {
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', [SHOP]), circle('c2', 'Werk', [])], own: own([SHOP]) });
    expect(r).toMatchObject({ kind: 'circle', atOnce: false, circleId: null });
    expect(r.to).toEqual([{ circleId: OWN, name: 'mine', own: true }, { circleId: 'c1', name: 'Thuis' }]);
  });

  it('no own list of that name: the circles read it as before', () => {
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', [SHOP])], own: own([]) });
    expect(r).toMatchObject({ kind: 'circle', atOnce: true, circleId: 'c1' });
  });

  it('"nieuwe lijst Vakantie" makes an own list; a line naming a circle makes it there', () => {
    expect(plusLineOutcome('nieuwe lijst Vakantie', { circles: [circle('c1', 'Thuis', [SHOP])], own: own([]) }))
      .toMatchObject({ kind: 'circle', atOnce: true, circleId: OWN, command: { opId: 'createList', args: { text: 'Vakantie', circleId: OWN } } });
    expect(plusLineOutcome('Thuis: maak een lijst Vakantie', { circles: [circle('c1', 'Thuis', [SHOP])], own: own([]) }))
      .toMatchObject({ kind: 'circle', atOnce: true, circleId: 'c1', command: { opId: 'createList' } });
  });

  it('"wat staat er op mijn boodschappen" reads the own list', () => {
    expect(plusLineOutcome('wat staat er op mijn boodschappen', { circles: [], own: own([SHOP]) }))
      .toMatchObject({ atOnce: true, circleId: OWN, command: { opId: 'listEntries', args: { list: 'Boodschappen' } } });
  });

  it('the own Agenda is not read as a list', () => {
    expect(plusLineOutcome('wat staat er op de agenda', { circles: [], own: own([{ name: 'Agenda', kind: 'list', defaultChild: 'calendar-event' }]) })).toBeNull();
  });

  it('the own lists are read with the own scope named by the model, through the call the shell makes as the ticked self', async () => {
    const asked = [];
    const lists = await plusOwnLists((app, opId, args) => { asked.push([app, opId, args]); return { items: [{ label: 'Boodschappen' }] }; });
    expect(asked).toEqual([['lists', 'listLists', { circleId: OWN }]]);
    expect(lists.map((l) => l.name)).toEqual(['Boodschappen']);
  });

  it('the op runs as the ticked self (the shell\'s own call); the card names it as mine', () => {
    expect(plusCircleOp({ appOrigin: 'lists', opId: 'addToList', args: { list: 'B', text: 'm' } }, OWN)).toMatchObject({ app: 'lists', own: true, args: { circleId: OWN } });
    expect(plusCircleOp({ appOrigin: 'lists', opId: 'addToList', args: {} }, 'c1').own).toBeUndefined();
    const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
    expect(plusCardLabel(t, { circleId: OWN, own: true })).toBe('circle.vandaag.plus_card_mine');
    expect(plusCardLabel(t, { circleId: 'c1', name: 'Thuis' })).toBe('circle.vandaag.plus_circle_in{"name":"Thuis"}');
  });
});

describe('the thread answers a read of a list', () => {
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  it('its entries, done ones marked; an empty list says so', () => {
    expect(plusDoneLine({ ok: true, title: 'Boodschappen', items: [{ label: '✓ melk', done: true }, { label: 'brood' }] }, { opId: 'listEntries', t }))
      .toBe('circle.vandaag.plus_list_items{"name":"Boodschappen","items":"✓ melk, brood"}');
    expect(plusDoneLine({ ok: true, title: 'Boodschappen', items: [] }, { opId: 'listEntries', t })).toBe('circle.vandaag.plus_list_empty{"name":"Boodschappen"}');
    expect(plusDoneLine({ ok: false, error: 'x' }, { opId: 'listEntries', t })).toBeNull();
  });
});

describe("the box has no '+': 'mijn boodschappen' in a DM is its household's list", () => {
  it("a household bot reads 'mijn' as a filler word before the list's name: nothing new, the household's list", () => {
    const rules = listsGateRules(null, [{ name: 'Boodschappen', kind: 'shopping' }]);
    const cmd = rules.map((r) => (r.test('zet melk op mijn boodschappen') ? r.command('zet melk op mijn boodschappen') : null)).find(Boolean);
    expect(cmd).toMatchObject({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } });
    expect(cmd.args.circleId, 'no own scope: the bot acts in its household').toBeUndefined();
  });
});
