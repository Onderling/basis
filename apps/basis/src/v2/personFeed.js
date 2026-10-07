/**
 * personFeed — a person's agenda as a link: the household's appointments that concern them, as an `.ics` sealed to a
 * key only their link carries.
 *
 * The bot renders it from its own projection — `remindedFor` decides whom an appointment concerns, as for the reminders
 * — and hands the sealed file to the household's companion, which serves it at `/feed/<id>.<k>.ics` and can open it
 * only with the `k` a request brings. The file leaves for a calendar service (Google, Apple), so it says as little as
 * an appointment needs: its title as written, start, end, place. No attendees, no other people's names, no notes, no
 * description, no categories. From 30 days back to everything ahead; a cancelled one stays for those 30 days as
 * cancelled, so a calendar app removes it rather than keeping a stale copy.
 */
import { buildIcsForEvents } from '@onderling/calendar-emission';
import { randomKey, sealForLink } from '@onderling/blob-gateway';
import { remindedFor } from './reminderOccurrences.js';

/** How far back the file reaches (a passed or cancelled appointment stays this long). */
const BACK_MS = 30 * 24 * 3600_000;

/**
 * The appointments in a person's file, each with only what a calendar app needs.
 * @param {object} a
 * @param {object[]} a.events   the household's `calendar-event` items
 * @param {object[]} a.people   the household's people (as `remindedFor` reads them)
 * @param {string}   a.person   whose file
 * @param {number}   [a.now]
 */
export function personFeedEvents({ events = [], people = [], person, now = Date.now() }) {
  const from = now - BACK_MS;
  return events
    .filter((e) => e && typeof e.id === 'string' && typeof e.startsAt === 'string')
    .filter((e) => Date.parse(e.endsAt ?? e.startsAt) >= from)
    .filter((e) => remindedFor(e, people).includes(person))
    .map((e) => ({
      id: e.id, title: e.title, startsAt: e.startsAt,
      ...(e.endsAt ? { endsAt: e.endsAt } : {}),
      ...(e.location ? { location: e.location } : {}),
      ...(e.state === 'cancelled' ? { state: 'cancelled' } : {}),
    }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The person's file as `.ics` text, named after the household. */
export function renderPersonFeed({ events, people, person, calendarName, now = Date.now() }) {
  return buildIcsForEvents({
    events: personFeedEvents({ events, people, person, now }),
    calendarName: calendarName || 'Onderling',
    prodId: '-//onderling//basis agenda//NL',
    now,
  });
}

/** A new link's two halves (128 random bits each, the bucket's minter): `id` names the file, `k` opens it. */
export function mintFeedLink() {
  return { id: randomKey(), k: randomKey() };
}

/** The file sealed to the link's key — the envelope, all the companion ever holds. */
export function sealPersonFeed(ics, k) {
  return sealForLink(ics, k);
}

/** The link as a person pastes it: `https://…` for Google, `webcal://…` for an iPhone. */
export function feedUrls(base, { id, k }) {
  const https = `${String(base).replace(/\/+$/, '')}/feed/${id}.${k}.ics`;
  return { https, webcal: https.replace(/^https?:\/\//, 'webcal://') };
}
