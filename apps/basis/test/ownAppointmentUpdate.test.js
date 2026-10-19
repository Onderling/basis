/**
 * A person's own appointment (Vandaag's "+") can be CHANGED — its title and its moment — through `calendar.updateEvent`,
 * in the own store like the add; the time keeps its length (an hour stays an hour), a day without a time is the whole day.
 * The own store is the person's: a door's caller reaches no own appointment, to read, change or cancel.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';

const boot = async (ds) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
const ownEvents = async (ds) => (await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event'));

describe("a person's own appointment can be changed", () => {
  it('title and moment change in the own store; the length stays', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    const made = await a.callSkill('calendar', 'addEvent', { title: 'tandarts', when: '2026-11-03T14:00:00.000Z' });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    const [ev] = await ownEvents(ds);
    const lengthBefore = new Date(ev.endsAt) - new Date(ev.startsAt);
    const up = await a.callSkill('calendar', 'updateEvent', { id: ev.id, title: 'tandarts (controle)', when: '2026-11-03T15:30:00.000Z' });
    expect(up?.ok, JSON.stringify(up)).toBe(true);
    const [after] = await ownEvents(ds);
    expect(after.title).toBe('tandarts (controle)');
    expect(after.startsAt).toBe('2026-11-03T15:30:00.000Z');
    expect(new Date(after.endsAt) - new Date(after.startsAt)).toBe(lengthBefore);
  });

  it('only the title, or only the moment', async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    await a.callSkill('calendar', 'addEvent', { title: 'kapper', when: '2026-11-04T09:00:00.000Z' });
    const [ev] = await ownEvents(ds);
    await a.callSkill('calendar', 'updateEvent', { id: ev.id, title: 'kapper Jan' });
    expect((await ownEvents(ds))[0].startsAt).toBe('2026-11-04T09:00:00.000Z');
    await a.callSkill('calendar', 'updateEvent', { id: ev.id, when: '2026-11-05T09:00:00.000Z' });
    expect((await ownEvents(ds))[0].title).toBe('kapper Jan');
  });

  it("a door's caller reaches no own appointment — nothing changes, nothing is cancelled", async () => {
    const ds = memoryDataSource();
    const a = await boot(ds);
    await a.callSkill('calendar', 'addEvent', { title: 'van mij', when: '2026-11-06T10:00:00.000Z' });
    const [ev] = await ownEvents(ds);
    await a.setDoorCaller('door-person', 'admin');
    const via = { caller: 'door-person', threadId: 'door-person', via: 'screen' };
    await a.callSkill('calendar', 'updateEvent', { id: ev.id, title: 'overschreven' }, via).catch(() => null);
    await a.callSkill('calendar', 'cancelEvent', { id: ev.id }, via).catch(() => null);
    const [after] = await ownEvents(ds);
    expect(after.title).toBe('van mij');
    expect(after.state ?? 'open').not.toBe('cancelled');
  });
});
