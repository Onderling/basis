/**
 * `contact` type — a person the user knows. Shared across all
 * three apps (Tasks circle membership, Pinboard contacts, Folio
 * share recipients).
 *
 * A contact usually carries a key (`pubKey`, or on a book row the card's `peerAddr` / `personKey`). One shape has
 * none, and the type declares it rather than leaving readers to meet it by surprise: THE KEYLESS ROW — a person a
 * hosting bot admitted through a door that carries no key (a Telegram user). Its id is door-shaped
 * (`<channel>:<uid>`, e.g. `telegram:4242`), it names the door (`channel`) and the role the host gave it (`role`),
 * and it has no `pubKey`. There is one row per person: admitting the same uid again returns the row it already has,
 * and when that person later takes an identity of their own, the SAME row gains its key.
 *
 * Every reader of the contact book is tested over `KEYLESS_CONTACT_EXAMPLE` in the package that holds the reader:
 * it works, or it refuses with `KEYLESS_REFUSAL` — it never throws and never invents a key.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

/**
 * The doors a person can be admitted by — the closed set, defined here and nowhere else. A hosting bot's user
 * registry imports it; the contact row's `channel` is one of these.
 */
export const CHANNELS = Object.freeze(['telegram', 'web', 'whatsapp']);

/** @param {unknown} v @returns {boolean} whether `v` is one of `CHANNELS` */
export const isChannel = (v) => typeof v === 'string' && CHANNELS.includes(v);

/**
 * The door a door-shaped id names (`telegram:4242` → `telegram`), or null for any other id — a key, a WebID URL, a
 * prefix outside `CHANNELS`, or a door with no uid behind it.
 * @param {unknown} webid
 * @returns {string|null}
 */
export function channelOfWebid(webid) {
  if (typeof webid !== 'string') return null;
  const i = webid.indexOf(':');
  if (i <= 0 || i === webid.length - 1) return null;
  const door = webid.slice(0, i);
  return isChannel(door) ? door : null;
}

/**
 * Whether a contact row is the keyless row: it names a door (a `channel`, or a door-shaped webid) and carries no key
 * it can be sealed to or reached at — no `pubKey`, no person key, no peer address. Such a row cannot found a pair
 * circle or receive a sealed share; readers that need a key refuse it. A row that names no door is never keyless by
 * this test, key fields or not: in the mesh binding a contact's webid IS its key (a row added by webid alone).
 * Pass `{ webid }` to ask about an id the book does not hold.
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isKeylessContact(row) {
  const has = (v) => typeof v === 'string' && v.length > 0;
  const door = isChannel(row?.channel) || channelOfWebid(row?.webid) !== null;
  return door && !(has(row?.pubKey) || has(row?.personKey?.pubKey) || has(row?.peerAddr));
}

/** The reason a reader that needs a key gives for a keyless row. */
export const KEYLESS_REFUSAL = 'keyless-contact';

/** The keyless row, as the type declares it — the fixture every reader of the book runs over. */
export const KEYLESS_CONTACT_EXAMPLE = Object.freeze({
  type:        'contact',
  id:          'telegram:4242',
  createdAt:   '2026-09-28T00:00:00.000Z',
  createdBy:   'urn:onderling:host',
  webid:       'telegram:4242',
  displayName: 'Door guest',
  channel:     'telegram',
  role:        'member',
});

/**
 * The contact row's FIELD-SETS that merge by their own clock (the `field-clock` resolution policy, read by the item
 * store's resolution registry). A person's devices change different parts of one row: a hide on one, the persona
 * this contact sees on another. Merged as a whole row, the newer row would carry the other part's old value; merged
 * per set, each set keeps the side whose clock is newer. The rest of the row stays row last-writer-wins.
 * `deletedAt` is its own clock: the delete mark stays after a return, and an older edit cannot drop it.
 */
export const CONTACT_FIELD_CLOCKS = Object.freeze([
  Object.freeze({ clock: 'hiddenAt',  fields: Object.freeze(['hidden']) }),
  Object.freeze({ clock: 'personaAt', fields: Object.freeze(['persona', 'revealPreset']) }),
  Object.freeze({ clock: 'linkedAt',  fields: Object.freeze(['linkedRow', 'linkedRoot']) }),
  Object.freeze({ clock: 'deletedAt', fields: Object.freeze([]) }),
]);

export const CONTACT_SCHEMA = {
  iri:         `${NAMESPACE}Contact`,
  description: 'A person the user knows. webid + displayName + optional key, trust, flags; a person admitted through a keyless door carries a channel and a role instead of a key.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'displayName'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'contact' },
    webid:       { type: 'string' },
    pubKey:      { type: 'string' },
    stableId:    { type: 'string' },
    displayName: { type: 'string', minLength: 1 },
    trustLevel:  { type: 'string', enum: ['unknown', 'bekend', 'vertrouwd'] },
    flags:       { type: 'object' },
    tags:        { type: 'array', items: { type: 'string' } },
    // the door this person came in by — one of CHANNELS
    channel:     { type: 'string', enum: [...CHANNELS] },
    // the role the host gave this person — a value from core's `ROLES` (or a role an app registered there). Not an
    // enum here: roles are extensible at runtime, and this package does not depend on core.
    role:        { type: 'string', minLength: 1 },
  },
  examples: [KEYLESS_CONTACT_EXAMPLE],
};
