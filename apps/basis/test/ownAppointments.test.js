/**
 * A person's own appointments (of no circle) are `calendar-event` items in their OWN store — the own-devices scope,
 * durable — under an own Agenda, served by the same ops as a circle's. They survive a restart (they used to live on an
 * in-memory pseudo-pod and were gone); briefSummary and searchEvents answer from them as the circle ops do.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';

const tomorrowAt = (h) => { const d = new Date(Date.now() + 86_400_000); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const titles = (r) => (r?.items ?? []).map((e) => String(e.title ?? e.label ?? e.text).replace(/^.* · /, ''));

describe("a person's own appointments", () => {
  it('live in the own store and come back after a restart', async () => {
    const ds = memoryDataSource();   // the shell's durable source (IndexedDB / AsyncStorage) — one across the restart
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const a = await boot();
    const made = await a.callSkill('calendar', 'addEvent', { title: 'hardlopen', when: tomorrowAt(8) });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event');
    expect(stored.map((e) => e.title)).toEqual(['hardlopen']);

    const b = await boot();   // a restart: a new agent over the same source
    expect(titles(await b.callSkill('calendar', 'listEvents', { days: 7 }))).toEqual(['hardlopen']);
  });

  it('briefSummary and searchEvents answer from them; cancel and rsvp act on them', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: memoryDataSource() }) });
    // the brief's window is the next 24 hours (as the calendar's own brief had it)
    const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
    await a.callSkill('calendar', 'addEvent', { title: 'tandarts', when: inHours(2) });
    await a.callSkill('calendar', 'addEvent', { title: 'kapper', when: inHours(5) });
    const brief = await a.callSkill('calendar', 'briefSummary', {});
    expect((brief?.items ?? []).length).toBe(2);
    expect(titles(await a.callSkill('calendar', 'searchEvents', { query: 'tand' }))).toEqual(['tandarts']);
    expect((await a.callSkill('calendar', 'rsvpDecline', { id: 'kapper' }))?.ok).toBe(true);
    expect((await a.callSkill('calendar', 'cancelEvent', { id: 'kapper' }))?.ok).toBe(true);
    expect(titles(await a.callSkill('calendar', 'listEvents', { days: 7 }))).toEqual(['tandarts']);
  });
});
