/**
 * `read-marks` type — what the person has READ in one group (a circle, a contact), so that reading something on one
 * device makes it read on all of them. One row per self and group, in that self's own-devices scope (sealed, carried
 * between the person's own devices by the sibling carry), never in a circle's store.
 *
 * `read` is a set of `{ id, at }`: the id of what was read (an item, a line, a message, a statement: ids are global)
 * and the SOURCE's own time (when it was said, the same on every device; never this device's landing time, which
 * differs per device). It only grows: two devices marking at once both keep their marks (the `set-union` resolution).
 * `prunedBefore` is the floor below which marks are dropped; it merges by its maximum and the set keeps only marks at or
 * after it, so pruning is the same on every device and a device that never pruned cannot bring a mark back.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const READ_MARKS_SCHEMA = {
  iri:         `${NAMESPACE}ReadMarks`,
  description: 'What I have read in one circle or conversation (own-devices scope only).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'group', 'read'],
  properties: {
    ...BASE_PROPERTIES,
    type:  { const: 'read-marks' },
    group: { type: 'string', minLength: 1 },
    read:  {
      type:  'array',
      items: {
        type:       'object',
        required:   ['id', 'at'],
        properties: { id: { type: 'string', minLength: 1 }, at: { type: 'number' } },
      },
    },
    prunedBefore: { type: 'number' },
  },
};

/** The type's set-union declaration: the set, each member's key and time, and the floor that prunes it. */
export const READ_MARKS_SET_UNION = Object.freeze({ field: 'read', key: 'id', at: 'at', floor: 'prunedBefore' });
