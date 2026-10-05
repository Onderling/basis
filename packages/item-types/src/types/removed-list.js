/**
 * `removed-list` type — a whole list removed from a circle, kept aside so it can be put back for a while (a household
 * bot keeps it 30 days). It holds the list and everything that went with it, whole; the list itself is out of the store,
 * so no read sees it. Restoring puts the items back under their own ids and drops this record; after the keep window
 * it is dropped unread.
 */
import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const REMOVED_LIST_SCHEMA = {
  iri:         `${NAMESPACE}RemovedList`,
  description: 'A list removed from the circle, kept aside (with what went with it) so it can be restored for a while.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'listId', 'name', 'removedAt', 'items'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'removed-list' },
    listId:    { type: 'string' },                    // the list's own id (it comes back under it)
    name:      { type: 'string' },                    // the list's name, to offer it back by
    removedAt: { type: 'number' },                    // ms; the keep window counts from here
    removedBy: { type: ['string', 'null'] },          // who removed it (said when it is offered back)
    items:     { type: 'array', items: { type: 'object' } },   // the list first, then what went with it, whole
    keptIds:   { type: 'array', items: { type: 'string' } },   // items also on another list: they stayed, re-linked on restore
  },
};
