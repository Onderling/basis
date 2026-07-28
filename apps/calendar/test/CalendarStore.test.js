/**
 * @onderling-app/calendar — CalendarStore tests.  v0.7.10.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { CalendarStore } from '../src/CalendarStore.js';

let store;
beforeEach(() => { store = new CalendarStore({ actor: 'webid:frits' }); });

describe('addEvent', () => {
  it('persists an event + returns canonical item', async () => {
    const e = await store.addEvent({
      title:    'Team standup',
      startsAt: '2026-06-01T09:00:00Z',
      endsAt:   '2026-06-01T09:30:00Z',
      location: 'Demo HQ',
      attendees: 'webid:anne, webid:karl',
    });
    expect(e.title).toBe('Team standup');
    expect(e.type).toBe('calendar-event');
    expect(e.startsAt).toBe('2026-06-01T09:00:00.000Z');
    expect(e.endsAt).toBe('2026-06-01T09:30:00.000Z');
    expect(e.location).toBe('Demo HQ');
    expect(e.attendees).toEqual(['webid:anne', 'webid:karl']);
    expect(e.organiser).toBe('webid:frits');
    expect(e.state).toBe('open');
    expect(e.id).toBeTruthy();
  });

  it('defaults endsAt to startsAt + 1h when omitted', async () => {
    const e = await store.addEvent({
      title: 'Quick chat',
      startsAt: '2026-06-01T15:00:00Z',
    });
    expect(e.endsAt).toBe('2026-06-01T16:00:00.000Z');
  });

  it('accepts attendees as array OR csv', async () => {
    const a = await store.addEvent({ title: 'A', startsAt: '2026-06-01T10:00:00Z', attendees: ['x', 'y'] });
    const b = await store.addEvent({ title: 'B', startsAt: '2026-06-01T11:00:00Z', attendees: 'x,y' });
    expect(a.attendees).toEqual(['x', 'y']);
    expect(b.attendees).toEqual(['x', 'y']);
  });

  it('persists attendees-addr for cross-peer cancel propagation (survives a soft cancel)', async () => {
    const e = await store.addEvent({
      title: 'A', startsAt: '2026-06-01T10:00:00Z', 'attendees-addr': 'addrA, addrB',
    });
    expect(e.attendeeAddrs).toEqual(['addrA', 'addrB']);
    await store.cancel({ eventId: e.id });
    const after = await store.getById(e.id);          // soft delete keeps the record + the addresses
    expect(after.state).toBe('cancelled');
    expect(after.attendeeAddrs).toEqual(['addrA', 'addrB']);
  });

  it('omits attendeeAddrs when none supplied', async () => {
    const e = await store.addEvent({ title: 'A', startsAt: '2026-06-01T10:00:00Z' });
    expect(e.attendeeAddrs).toBeUndefined();
  });

  it("rejects missing title", async () => {
    await expect(store.addEvent({ startsAt: '2026-06-01T10:00:00Z' }))
      .rejects.toThrow(/title required/);
  });

  it("rejects missing or invalid when (formerly startsAt)", async () => {
    await expect(store.addEvent({ title: 'X' }))
      .rejects.toThrow(/when \(or startsAt\) required/);
    await expect(store.addEvent({ title: 'X', when: 'not-a-date' }))
      .rejects.toThrow(/when \(or startsAt\) required/);
    // back-compat: legacy startsAt still works
    const ok = await store.addEvent({ title: 'Y', startsAt: '2026-06-01T10:00:00Z' });
    expect(ok.title).toBe('Y');
  });
});

describe('listInRange', () => {
  beforeEach(async () => {
    await store.addEvent({ title: 'A (yesterday)', startsAt: new Date(Date.now() - 86_400_000).toISOString() });
    await store.addEvent({ title: 'B (today)',     startsAt: new Date(Date.now() + 3_600_000).toISOString() });
    await store.addEvent({ title: 'C (next week)', startsAt: new Date(Date.now() + 6 * 86_400_000).toISOString() });
    await store.addEvent({ title: 'D (next month)',startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  });

  it('default window = next 7 days, since now', async () => {
    const r = await store.listInRange();
    expect(r.map((e) => e.title)).toEqual(['B (today)', 'C (next week)']);
  });

  it('custom window narrows result', async () => {
    const r = await store.listInRange({
      since: Date.now(),
      until: Date.now() + 4 * 86_400_000,
    });
    expect(r.map((e) => e.title)).toEqual(['B (today)']);
  });

  it("returns sorted by startsAt asc", async () => {
    await store.addEvent({ title: 'Z (sooner)', startsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
    const r = await store.listInRange();
    expect(r[0].title).toBe('Z (sooner)');
  });
});

describe('rsvp', () => {
  let eventId;
  beforeEach(async () => {
    const e = await store.addEvent({
      title:    'Drinks',
      startsAt: '2026-07-01T18:00:00Z',
      attendees: ['webid:anne', 'webid:karl', 'webid:maria'],
    });
    eventId = e.id;
  });

  it("accepted / declined / tentative all land", async () => {
    await store.rsvp({ eventId, actor: 'webid:anne',  response: 'accepted'  });
    await store.rsvp({ eventId, actor: 'webid:karl',  response: 'declined'  });
    await store.rsvp({ eventId, actor: 'webid:maria', response: 'tentative' });
    const event = await store.getById(eventId);
    expect(event.rsvp).toEqual({
      'webid:anne':  'accepted',
      'webid:karl':  'declined',
      'webid:maria': 'tentative',
    });
  });

  it("re-rsvp overwrites the previous response", async () => {
    await store.rsvp({ eventId, actor: 'webid:anne', response: 'declined' });
    await store.rsvp({ eventId, actor: 'webid:anne', response: 'accepted' });
    const event = await store.getById(eventId);
    expect(event.rsvp['webid:anne']).toBe('accepted');
  });

  it("rejects unknown response", async () => {
    await expect(store.rsvp({ eventId, actor: 'webid:anne', response: 'maybe' }))
      .rejects.toThrow(/bad response/);
  });

  it("rejects unknown event", async () => {
    await expect(store.rsvp({ eventId: 'does-not-exist', actor: 'webid:x', response: 'accepted' }))
      .rejects.toThrow(/no event/);
  });
});

describe('cancel', () => {
  it("markComplete then listInRange skips the event", async () => {
    const e = await store.addEvent({
      title: 'Cancelled meeting',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await store.cancel({ eventId: e.id });
    const open = await store.listInRange();
    expect(open.find((x) => x.id === e.id)).toBeUndefined();
  });
});

describe('search', () => {
  beforeEach(async () => {
    await store.addEvent({ title: 'Team standup',     startsAt: '2026-06-01T09:00:00Z' });
    await store.addEvent({ title: 'Coffee with Anne', startsAt: '2026-06-01T11:00:00Z', location: 'Café Rotterdam' });
    await store.addEvent({ title: 'Project review',   startsAt: '2026-06-02T14:00:00Z' });
  });

  it("matches title substring (case-insensitive)", async () => {
    expect((await store.search('team')).map((e) => e.title)).toEqual(['Team standup']);
    expect((await store.search('PROJECT')).map((e) => e.title)).toEqual(['Project review']);
  });

  it("matches location substring", async () => {
    expect((await store.search('rotterdam')).map((e) => e.title)).toEqual(['Coffee with Anne']);
  });

  it("empty query → empty result", async () => {
    expect(await store.search('')).toEqual([]);
    expect(await store.search('   ')).toEqual([]);
  });

  it("no match → empty result", async () => {
    expect(await store.search('zzzzz')).toEqual([]);
  });
});

describe('iCal feed (v0.7.11)', () => {
  beforeEach(async () => {
    await store.addEvent({
      title: 'Team standup',
      startsAt: '2026-06-01T09:00:00Z',
      endsAt:   '2026-06-01T09:30:00Z',
      location: 'Demo HQ',
      attendees: ['webid:anne', 'webid:karl'],
    });
    await store.addEvent({
      title: 'Drinks',
      startsAt: '2026-06-01T18:00:00Z',
      endsAt:   '2026-06-01T20:00:00Z',
      attendees: ['webid:maria'],
    });
  });

  it("returns a VCALENDAR with one VEVENT per event", async () => {
    const { ics, uri } = await store.getIcsFeed();
    expect(uri).toMatch(/calendar\/feed\.ics$/);
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toMatch(/X-WR-CALNAME:Onderling Calendar/);
    const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(vevents).toBe(2);
    expect(ics).toMatch(/SUMMARY:Team standup/);
    expect(ics).toMatch(/SUMMARY:Drinks/);
    expect(ics).toMatch(/LOCATION:Demo HQ/);
  });

  it("RSVP responses surface as PARTSTAT in the feed", async () => {
    const events = await store.listInRange({ since: 0, until: 99999999999999 });
    const drinks = events.find((e) => e.title === 'Drinks');
    await store.rsvp({ eventId: drinks.id, actor: 'webid:maria', response: 'accepted' });
    const { ics } = await store.getIcsFeed();
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=ACCEPTED:mailto:webid:maria/);
  });

  it("cancelled events surface as STATUS:CANCELLED in the feed", async () => {
    const events = await store.listInRange({ since: 0, until: 99999999999999 });
    const standup = events.find((e) => e.title === 'Team standup');
    await store.cancel({ eventId: standup.id });
    const { ics } = await store.getIcsFeed();
    // The cancelled event still appears in the feed so subscribers
    // see the STATUS:CANCELLED transition.
    expect(ics).toMatch(/STATUS:CANCELLED/);
  });
});
