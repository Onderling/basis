/**
 * `inbox-item` type — a piece of work waiting on a person's decision.
 *
 * The noun the tasks manifest has always declared for the subtask negotiation: a worker asks to
 * open a subtask, or proposes a change instead of accepting the work as submitted, and the item
 * sits in the deciding person's inbox until they approve or decline it.
 *
 * `kind` is what the item is waiting FOR — `subtask-request`, `subtask-proposal` — and the manifest
 * discriminates on it (`appliesTo: {type: 'inbox-item', kind: 'subtask-proposal'}`), which is why
 * it is a top-level property rather than something tucked into `source`. Adding a new negotiation
 * is a new `kind` plus its two manifest rows, not a new type.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const INBOX_ITEM_SCHEMA = {
  iri:         `${NAMESPACE}InboxItem`,
  description: 'A request or proposal awaiting one person\'s approval.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'kind'],
  properties: {
    ...BASE_PROPERTIES,
    type: { const: 'inbox-item' },
    kind: { type: 'string', enum: ['subtask-request', 'subtask-proposal'] },
    // The task this decision hangs off — the parent whose depth or submission is in question.
    parentTaskId: { type: 'string' },
    // Who is waiting on the answer, and what they asked for. `partial` carries the child-task
    // arguments to spawn on approval, so approving needs nothing the item does not already hold.
    requestedBy:  { type: 'string' },
    partial:      { type: 'object' },
  },
};

/** The two kinds, named once so no caller spells them as string literals. */
export const INBOX_KIND = Object.freeze({
  SUBTASK_REQUEST:  'subtask-request',
  SUBTASK_PROPOSAL: 'subtask-proposal',
});

/**
 * Is this the inbox item we mean — the noun AND the kind, never one without the other.
 *
 * Every caller wants both halves, and the half that used to be checked alone (`type ===
 * 'subtask-request'`) was checking a type that no longer exists, so it silently answered no
 * everywhere. Exported from the type's own package because both apps and other packages ask.
 */
export function isInboxItem(item, kind) {
  if (item?.type !== 'inbox-item') return false;
  return kind === undefined ? true : item?.kind === kind;
}
