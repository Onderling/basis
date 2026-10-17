/**
 * `announcement` type — a broadcast to a circle (or sub-audience).
 * Pinboard's group announcements; Tasks's circle-wide notices.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const ANNOUNCEMENT_SCHEMA = {
  iri:         `${NAMESPACE}Announcement`,
  description: 'A broadcast post to a circle or sub-audience.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'announcement' },
    title:     { type: 'string' },
    body:      { type: 'string' },
    audience:  { type: 'array', items: { type: 'string' } },
    pinUntil:  { type: 'string', format: 'date-time' },
  },
};
