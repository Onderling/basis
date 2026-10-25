/**
 * itemPresenters — the FALLBACK for how a merged view (`acrossCircles`) shows a canonical noun no manifest declares
 * facets for yet. A noun's manifest declares them (`nouns[noun].presents`, built by `declaredPresenters.js`); a noun
 * that gains a declaration leaves this table in the same change — it only shrinks.
 *
 * Complete when every `CANONICAL_TYPES` noun has a presenter (declared or here) or is named below with its reason
 * (`test/fitness/itemPresentersComplete.test.js`): `NOT_YET` only shrinks.
 */

const text = (r) => String(r?.title ?? r?.text ?? r?.label ?? r?.name ?? '').trim();
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(n) ? n : 0; };
const byAuthor = (r, me) => Boolean(me) && [r?.createdBy, r?.author, r?.actor, r?.by].includes(me);

/** @type {Record<string, {label: (row: object) => string, when: (row: object) => number, order: 'asc'|'desc', isMine: (row: object, me: string|null) => boolean, isDone: (row: object) => boolean}>} */
export const ITEM_PRESENTERS = Object.freeze({
  announcement: { label: text, when: (r) => ms(r.createdAt ?? r.ts), order: 'desc', isMine: byAuthor, isDone: () => false },
});

/** Shown from the device log, not merged from stores: a message's entry IS its render event (architecture §3). */
export const LOG_PROJECTED = Object.freeze({ 'chat-message': 'the event-log projection', 'chat-thread': 'the event-log projection' });

/** Never shown in a merged view, by design: a removed list is kept aside and offered back by `restoreList` only. */
export const NOT_MERGED = Object.freeze({
  'removed-list': 'kept aside; offered back by /list-restore, never merged into a view',
  'removed-entry': 'the trash; offered back by /prullenbak (its maker or an admin), never merged into a view',
  // an intention is never a chore, an item or a reminder: what is planned is read by `upcoming` (intentions.js) only
  intention: 'pending work; read by `upcoming` only, never merged into chores, "Mijn dingen" or reminders',
  // a device-link is the person's private device map (own-devices scope, read by the revoke ceremony) — never shown
  'device-link': 'the private device map; read by the revoke ceremony only, never shown in any view',
  // a membership code is the admin's secret (own-devices scope): read by the invite and redeem paths only, never shown
  'membership-code': "a circle's invite code, the admin's own; read by the invite and redeem paths, never shown in any view",
  // who answered my post: folded into the post on the poster's own reads only (routedStore), never shown on its own
  'post-answers': "who answered one of my posts; folded into the post on my own reads, never shown on its own",
  // an answer to an appointment is read through its appointment only (its `rsvp`, projected by rsvpItems.js)
  rsvp: 'one person\'s answer to one appointment; read through its event (withAnswers), never shown on its own',
  // a roster-trail row is what the circle's roster is projected FROM (deriveRoster) — the roster is the view, never the row
  'membership-redemption': 'a row of the roster trail; read through the roster projection only, never shown on its own',
  // a circle's rules head is read by the rules screen, the consent step and the fold — the rules are the view, not the row
  'group-rules': "a circle's rules head; read through the rules screen and the fold, never merged into a view",
});

/**
 * Canonical nouns without a presenter yet — this list only shrinks.
 * `neighbourhood-job` has NO PRODUCER: no manifest declares it and no skill writes one, so a presenter would show
 * nothing. Whether a job is its own thing or an ask with a nested task is an open design question; it is retired or
 * given a producer then — not presented before.
 */
export const NOT_YET = Object.freeze(['claim', 'contact', 'reveal-request', 'neighbourhood-job', 'view', 'circle', 'shared-ref', 'media', 'inbox-item', 'board']);
