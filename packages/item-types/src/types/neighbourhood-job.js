/**
 * `neighbourhood-job` type — Stoop's coordinated neighbourhood-job
 * lifecycle (paint the wall, clean the park). Tracks the
 * "someone needs help → people commit → work happens → done"
 * arc.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const NEIGHBOURHOOD_JOB_SCHEMA = {
  iri:         `${NAMESPACE}NeighbourhoodJob`,
  description: 'A coordinated neighbourhood-job with a lifecycle (open → committed → in-progress → closed).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'neighbourhood-job' },
    body:        { type: 'string' },
    location:    { type: 'string' },
    startsAt:    { type: 'string', format: 'date-time' },
    endsAt:      { type: 'string', format: 'date-time' },
    status:      {
      type: 'string',
      enum: ['open', 'committed', 'in-progress', 'closed', 'cancelled'],
    },
    commitments: { type: 'array', items: { type: 'object' } },
    audience:    { type: 'array', items: { type: 'string' } },
  },
};
