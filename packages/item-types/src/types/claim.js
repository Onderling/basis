/**
 * `claim` (the NOUN) — a standalone item-type: "I want to act on a
 * specific post." A claim binds a second party to a specific `offer`
 * or `request` and tracks the coordination lifecycle (requested →
 * agreed → in-progress → completed | cancelled).
 *
 * ⚠ VERB-vs-NOUN DISAMBIGUATION (verb × noun algebra, PLAN Phase 0). The
 * token `claim` names TWO distinct things in this codebase — keep them apart:
 *
 *   • the `claim` **ATOM** (a VERB) — `@onderling/app-manifest` atoms.js:
 *     "self-assign an open item", a compare-and-swap on an EXISTING item's
 *     assignee, IN-PLACE. Used as `verb: 'claim'` on `task` / `post` /
 *     `calendar-event` (tasks-v0, pinboard, calendar, household manifests).
 *     No new item is created — one field of the target item changes.
 *
 *   • the `claim` **NOUN** — THIS item-type (`CLAIM_SCHEMA`): a NEW,
 *     standalone binding item that references another item (`itemRef`) and
 *     carries its own lifecycle `status`. A distinct row in the store, not a
 *     mutation of the referenced offer/request.
 *
 * So "claim a task" (verb) mutates the task's assignee; "a claim on an offer"
 * (noun) mints a `claim` item pointing at the offer. They are NOT
 * interchangeable and MUST NOT be conflated in a manifest: a `nouns` block
 * that lists `claim` under some type's `atoms` is using the VERB; declaring
 * `'claim'` in `itemTypes` is using the NOUN. The item-type is deliberately
 * NOT renamed (large blast radius — persisted `type: {const:'claim'}`
 * discriminator + registry public API + the `lend-request` alias); the naming
 * is disambiguated by this doc + the manifest-standard, per repo code-respect.
 *
 * Replaces the legacy `lend-request` type. The shape is general
 * enough to cover lend/borrow, give/receive, gig-style claims on
 * neighbourhood-jobs, and any future flow that needs "match against
 * a specific posted item".
 *
 * Standardisation: Phase 52.1 vocabulary refresh (2026-05-12).
 * Legacy name `lend-request` is still recognised as an alias for
 * this type while consumers migrate.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CLAIM_SCHEMA = {
  iri:         `${NAMESPACE}Claim`,
  description: 'A specific claim against an offer or request.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'itemRef'],
  properties: {
    ...BASE_PROPERTIES,
    type: { const: 'claim' },
    /**
     * URI of the offer or request being claimed against. Cross-pod
     * refs are fine; the substrate's embeds traversal resolves them.
     */
    itemRef: { type: 'string', minLength: 1 },
    /**
     * Coarse-grained lifecycle the substrate enforces. Fine-grained
     * states ('handed-over', 'returned' for lend flows; 'paid' for
     * buy flows) live on app-level extension fields rather than in
     * the canonical enum.
     */
    status: {
      type: 'string',
      enum: ['requested', 'agreed', 'in-progress', 'completed', 'cancelled'],
    },
    body:        { type: 'string' },
    audience:    { type: 'array', items: { type: 'string' } },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
