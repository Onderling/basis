/**
 * `post-answers` type — who answered MY post (`responders`, recorded from the 1:1 answers I received): the poster's own
 * knowledge, kept in the poster's own-devices scope (sealed, carried between the poster's own devices) and folded back
 * into the post on every read of it there. Never on the circle's store, which every member syncs.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const POST_ANSWERS_SCHEMA = {
  iri:         `${NAMESPACE}PostAnswers`,
  description: 'Who answered one of my posts (own-devices scope only).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'source'],
  properties: {
    ...BASE_PROPERTIES,
    type:   { const: 'post-answers' },
    source: {
      type:     'object',
      required: ['itemId'],
      properties: {
        itemId:     { type: 'string', minLength: 1 },
        responders: { type: 'array' },
      },
    },
  },
};
