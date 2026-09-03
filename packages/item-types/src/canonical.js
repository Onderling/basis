/**
 * The canonical type set that ships with `@onderling/item-types`.
 *
 * Apps that want to add bespoke types call `registerType(...)`
 * on the same registry (or a fresh one via `createRegistry()`).
 */

import { NAMESPACE }                from './baseSchema.js';
import { TASK_SCHEMA }              from './types/task.js';
import { NOTE_SCHEMA }              from './types/note.js';
import { CHAT_MESSAGE_SCHEMA }      from './types/chat-message.js';
import { CHAT_THREAD_SCHEMA }       from './types/chat-thread.js';
import { OFFER_SCHEMA }             from './types/offer.js';
import { REQUEST_SCHEMA }           from './types/request.js';
import { CLAIM_SCHEMA }             from './types/claim.js';
import { CONTACT_SCHEMA }           from './types/contact.js';
import { CALENDAR_EVENT_SCHEMA }    from './types/calendar-event.js';
import { ANNOUNCEMENT_SCHEMA }      from './types/announcement.js';
import { REVEAL_REQUEST_SCHEMA }    from './types/reveal-request.js';
import { NEIGHBOURHOOD_JOB_SCHEMA } from './types/neighbourhood-job.js';
import { VIEW_SCHEMA }              from './types/view.js';
import { CIRCLE_SCHEMA }            from './types/circle.js';
import { SHARED_REF_SCHEMA }        from './types/shared-ref.js';
import { MEDIA_SCHEMA }             from './types/media.js';
import { INBOX_ITEM_SCHEMA }        from './types/inbox-item.js';

/**
 * Map of canonical name → schema. Useful for `Object.entries(...)`
 * iteration when building a fresh registry.
 *
 * Vocabulary refresh 2026-05-12: `offer` + `request` + `claim`
 * replace the legacy `supply-offer` / `demand-offer` / `lend-request`
 * trio. Old names persist as **aliases** (see `LEGACY_ALIASES` below)
 * so already-written data + apps in transition keep validating.
 */
/* ── The composable containers (2026-09-01, lifted from `kring-host/circleLists.js`) ─────────────── */
/** A list: a named container of entries. */
const LIST_SCHEMA = Object.freeze({
  iri: `${NAMESPACE}List`,
  type: 'object', properties: { type: { const: 'list' }, text: { type: 'string', minLength: 1 } }, required: ['type', 'text'],
});
/** An entry in a container — and itself a container, which is what makes the nesting composable. */
const LIST_ITEM_SCHEMA = Object.freeze({
  iri: `${NAMESPACE}ListItem`,
  type: 'object',
  properties: { type: { const: 'list-item' }, text: { type: 'string', minLength: 1 }, completedAt: { type: ['number', 'null'] } },
  required: ['type', 'text'],
});
/** A board: a HETEROGENEOUS container with NO default child type, so "+ add" is a genuine choice. */
const BOARD_SCHEMA = Object.freeze({
  iri: `${NAMESPACE}Board`,
  type: 'object', properties: { type: { const: 'board' }, text: { type: 'string', minLength: 1 } }, required: ['type', 'text'],
});

export const CANONICAL_TYPES = Object.freeze({
  'task':               TASK_SCHEMA,
  'note':               NOTE_SCHEMA,
  'chat-message':       CHAT_MESSAGE_SCHEMA,
  // #81 (2026-07-05): canonical companion to chat-message — the
  // conversation container basis's shell declares alongside it.
  'chat-thread':        CHAT_THREAD_SCHEMA,
  'offer':              OFFER_SCHEMA,
  'request':            REQUEST_SCHEMA,
  'claim':              CLAIM_SCHEMA,
  'contact':            CONTACT_SCHEMA,
  'calendar-event':     CALENDAR_EVENT_SCHEMA,
  'announcement':       ANNOUNCEMENT_SCHEMA,
  'reveal-request':     REVEAL_REQUEST_SCHEMA,
  'neighbourhood-job':  NEIGHBOURHOOD_JOB_SCHEMA,
  // V0 additions (2026-05-20):
  'view':               VIEW_SCHEMA,
  'circle':             CIRCLE_SCHEMA,
  // cross-circle per-item share reference.
  'shared-ref':         SHARED_REF_SCHEMA,
  // Media Phase 1 (2026-07-09): canonical media noun — points at a
  // blob-gateway manifest line (or any embeds-shaped ref); no bytes.
  'media':              MEDIA_SCHEMA,
  // The subtask negotiation's noun. Its two kinds were being written as bare TYPES
  // (`subtask-request` / `subtask-proposal`), which no registry knew, so every "ask for a change
  // instead of approving" failed at the store — while the manifest had been declaring
  // `{type: 'inbox-item', kind: …}` for them all along. This is that declaration, made real.
  'inbox-item':         INBOX_ITEM_SCHEMA,
  // The composable CONTAINERS (2026-09-01). They were registered privately by `circleLists.js` on a
  // registry of its own, which is what put lists in a SECOND store per circle — and the architecture is
  // explicit that "two stores for one circle is a defect, not a design", and that a type reaching a peer
  // some other way is a second implementation of sync. A type the shared store must hold is a canonical
  // noun; declaring them here is what lets a list item ride the one fan-out path every other item takes.
  //
  // `list` — a container of entries. `list-item` — an entry, itself a container (the nesting is real, and
  // what a container ACCEPTS is the `accepts` policy's business, not the schema's). `board` — a container
  // with no default child type, so "+ add" is a genuine choice.
  'list':               LIST_SCHEMA,
  'list-item':          LIST_ITEM_SCHEMA,
  'board':              BOARD_SCHEMA,
});

/**
 * Legacy-name → canonical-name aliases for the 2026-05-12 vocabulary
 * refresh. The registry resolves these transparently — `validate({type:
 * 'supply-offer'})` routes to the `offer` schema. Adopters can drop
 * the legacy names on their own schedule.
 */
export const LEGACY_ALIASES = Object.freeze({
  'offer':    ['supply-offer'],
  'request':  ['demand-offer'],
  'claim':    ['lend-request'],
});

/**
 * Register every canonical type on the supplied registry, including
 * the legacy-name aliases.
 *
 * @param {ReturnType<typeof import('./registry.js').createRegistry>} registry
 */
/**
 * The composable lists' nouns, named once.
 *
 * They live in the circle's one store like everything else — a list entry and a task are siblings there,
 * and that is the point of one store. What they are NOT is tasks: a listing that computes task status
 * over "everything in the store" must skip them, or a shopping list and its entries show up among the
 * chores. That is what happened the day lists moved onto the circle's own store, and it is a PROJECTION
 * question, not a storage one — which types a given surface shows is that surface's decision, and this
 * names the set so each surface can decide it out loud instead of guessing per type.
 */
export const LISTS_TYPES = Object.freeze(['list', 'list-item', 'board']);

export function registerCanonicalTypes(registry) {
  for (const [name, schema] of Object.entries(CANONICAL_TYPES)) {
    const aliases = LEGACY_ALIASES[name];
    registry.registerType(name, schema, aliases ? { aliases } : undefined);
  }
}
