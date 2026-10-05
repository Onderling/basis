/**
 * itemPresenters — how a row of each canonical item type is shown when rows of many circles are merged
 * (`acrossCircles`): its label, the moment it sorts by, and whether it is "mine". Declared once, read by web and
 * mobile; the type's own schema stays in `@onderling/item-types`, this is only how a merged view shows a row.
 *
 * Complete when every `CANONICAL_TYPES` noun has a presenter or is named below with its reason
 * (`test/fitness/itemPresentersComplete.test.js`): `NOT_YET` only shrinks.
 */

const text = (r) => String(r?.title ?? r?.text ?? r?.label ?? r?.name ?? '').trim();
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(n) ? n : 0; };
const byAuthor = (r, me) => Boolean(me) && [r?.createdBy, r?.author, r?.actor, r?.by].includes(me);

/** @type {Record<string, {label: (row: object) => string, when: (row: object) => number, order: 'asc'|'desc', isMine: (row: object, me: string|null) => boolean}>} */
export const ITEM_PRESENTERS = Object.freeze({
  // a chore: newest first; mine when I hold it
  task: { label: text, when: (r) => ms(r.addedAt ?? r.ts ?? r.createdAt), order: 'desc',
    isMine: (r, me) => Boolean(me) && (r.assignee === me || (Array.isArray(r.holders) && r.holders.includes(me)) || (Array.isArray(r.assignees) && r.assignees.includes(me))) },
  // an appointment: soonest first; mine when I made it or am asked to it
  'calendar-event': { label: text, when: (r) => ms(r.startsAt), order: 'asc',
    isMine: (r, me) => byAuthor(r, me) || (Boolean(me) && Array.isArray(r.attendees) && r.attendees.some((a) => (a?.webid ?? a) === me)) },
  note: { label: text, when: (r) => ms(r.updatedAt ?? r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor },
  announcement: { label: text, when: (r) => ms(r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor },
  // an offer or a request: mine when I placed it (still open is the read's own filter)
  offer: { label: text, when: (r) => ms(r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor },
  request: { label: text, when: (r) => ms(r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor },
  list: { label: text, when: (r) => ms(r.createdAt ?? r.ts), order: 'asc', isMine: byAuthor },
  'list-item': { label: text, when: (r) => ms(r.addedAt ?? r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor },
});

/** Shown from the device log, not merged from stores: a message's entry IS its render event (architecture §3). */
export const LOG_PROJECTED = Object.freeze({ 'chat-message': 'the event-log projection', 'chat-thread': 'the event-log projection' });

/** Never shown in a merged view, by design: a removed list is kept aside and offered back by `restoreList` only. */
export const NOT_MERGED = Object.freeze({ 'removed-list': 'kept aside; offered back by /list-restore, never merged into a view' });

/** Canonical nouns without a presenter yet — this list only shrinks. */
export const NOT_YET = Object.freeze(['claim', 'contact', 'reveal-request', 'neighbourhood-job', 'view', 'circle', 'shared-ref', 'media', 'inbox-item', 'board']);
