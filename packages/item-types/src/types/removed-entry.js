/**
 * `removed-entry` type — an entry someone took off ANOTHER person's list, kept aside (the trash) so its maker or an
 * admin can put it back for a while (the same keep window and sweep as a removed list). It holds the entry whole; the
 * entry itself is out of the store, so no read, digest, history or reminder sees it. Restoring puts it back under its own
 * id on its list and drops this record; after the keep window it is dropped unread.
 */
import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const REMOVED_ENTRY_SCHEMA = {
  iri:         `${NAMESPACE}RemovedEntry`,
  description: 'An entry taken off a list by someone other than its maker, kept aside so it can be restored for a while.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'entryId', 'listId', 'name', 'removedAt', 'items'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'removed-entry' },
    entryId:   { type: 'string' },                    // the entry's own id (it comes back under it)
    listId:    { type: 'string' },                    // the list it was on (it goes back there)
    listName:  { type: 'string' },                    // that list's name, to say where it goes back
    name:      { type: 'string' },                    // the entry's words, to offer it back by
    removedAt: { type: 'number' },                    // ms; the keep window counts from here
    removedBy: { type: ['string', 'null'] },          // who took it off (an internal person id; the door words it)
    items:     { type: 'array', items: { type: 'object' } },   // the entry, whole
  },
};
