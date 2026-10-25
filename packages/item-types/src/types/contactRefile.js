/**
 * `contact-refile` type — a contact LEFT one of the person's selves: on a device of the person it was filed under
 * another self. Written as the self it left, so it rides only that self's own-devices lane and tells only that self's
 * devices to drop it from their book. It never says where the contact went: the self that gained it learns that from
 * the contact itself, carried on its own lane. Own-devices scope only — never in a circle, never on a roster.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CONTACT_REFILE_SCHEMA = {
  iri:         `${NAMESPACE}ContactRefile`,
  description: 'A contact that left one of the person\'s selves, and when (own-devices scope only; never where it went).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'webid', 'left', 'at'],
  properties: {
    ...BASE_PROPERTIES,
    type:  { const: 'contact-refile' },
    webid: { type: 'string', minLength: 1 },
    left:  { const: true },
    at:    { type: 'number' },
  },
};
