/**
 * A person's agenda as a link — the bot's half: whose appointments go in the file, what of each, and the seal only the
 * link's key opens.
 */
import { describe, it, expect } from 'vitest';
import { openForLink } from '@onderling/blob-gateway';
import { personFeedEvents, renderPersonFeed, mintFeedLink, sealPersonFeed, feedUrls } from '../src/v2/personFeed.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const DAY = 86_400_000;
const at = (d) => new Date(NOW + d * DAY).toISOString();
const PEOPLE = [{ id: 'telegram:1' }, { id: 'telegram:2' }, { id: 'telegram:3' }];
const EVENTS = [
  // shared (names nobody): everyone's
  { id: 'e1', type: 'calendar-event', title: 'Schoonmaakavond', startsAt: at(2), createdBy: 'telegram:1', body: 'neem de stofzuiger mee' },
  // names Bea only: hers and its maker's
  { id: 'e2', type: 'calendar-event', title: 'Tandarts Bea', startsAt: at(3), endsAt: at(3.05), location: 'Kerkstraat 1', createdBy: 'telegram:1', attendees: ['telegram:2'], rsvp: { 'telegram:2': 'accepted' } },
  // Carla declined the shared dinner: not hers
  { id: 'e3', type: 'calendar-event', title: 'Etentje', startsAt: at(5), createdBy: 'telegram:1', rsvp: { 'telegram:3': 'declined' } },
  // long gone: in no file
  { id: 'e4', type: 'calendar-event', title: 'Oud', startsAt: at(-40), createdBy: 'telegram:1' },
  // cancelled last week: stays, as cancelled
  { id: 'e5', type: 'calendar-event', title: 'Afgezegd', startsAt: at(-7), createdBy: 'telegram:1', state: 'cancelled' },
];

describe('the person\'s agenda file', () => {
  it('holds the appointments that concern the person (remindedFor), 30 days back and all ahead', () => {
    const ids = (person) => personFeedEvents({ events: EVENTS, people: PEOPLE, person, now: NOW }).map((e) => e.id);
    expect(ids('telegram:2')).toEqual(['e5', 'e1', 'e2', 'e3']);
    expect(ids('telegram:3'), 'not the one naming Bea, not the one Carla declined').toEqual(['e5', 'e1']);
  });

  it('says only title, start, end and place — no attendees, no notes, no description', () => {
    const ics = renderPersonFeed({ events: EVENTS, people: PEOPLE, person: 'telegram:2', calendarName: 'Huize Zon', now: NOW });
    expect(ics).toContain('X-WR-CALNAME:Huize Zon');
    expect(ics).toContain('SUMMARY:Tandarts Bea');
    expect(ics).toContain('LOCATION:Kerkstraat 1');
    expect(ics).toMatch(/STATUS:CANCELLED/);
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|CATEGORIES/);
    expect(ics).not.toContain('stofzuiger');
    expect(ics).not.toContain('telegram:');
  });

  it('a link\'s halves carry at least 128 random bits each, and only its key opens the seal', () => {
    const a = mintFeedLink(); const b = mintFeedLink();
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(a.k).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(a.id.length * 6).toBeGreaterThanOrEqual(128);
    expect(a.k.length * 6).toBeGreaterThanOrEqual(128);
    expect(a.id).not.toBe(b.id);
    const ics = renderPersonFeed({ events: EVENTS, people: PEOPLE, person: 'telegram:2', now: NOW });
    const envelope = sealPersonFeed(ics, a.k);
    expect(envelope).not.toContain('Tandarts');
    expect(openForLink(envelope, a.k)).toBe(ics);
    expect(openForLink(envelope, b.k)).toBeNull();
  });

  it('the link as pasted: https for Google, webcal for an iPhone', () => {
    expect(feedUrls('https://relay.example.org/', { id: 'I', k: 'K' })).toEqual({
      https: 'https://relay.example.org/feed/I.K.ics', webcal: 'webcal://relay.example.org/feed/I.K.ics',
    });
  });
});
