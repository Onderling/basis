/**
 * `intention` type — pending work: do this op, with these arguments, as this person, when this trigger fires.
 *
 * A row is a record of what someone (a person, the app, an extension) wants done later; it lives in an ordinary store
 * and syncs like any item. Its occurrences are never stored: they are read from the row (`upcoming` / `due`), and a
 * done-mark under an occurrence's id is what takes one off. The trigger grammar is closed:
 *   - `{ at: <ISO> }`                                    once;
 *   - `{ every: 'day' | 'week', on?: 'sun'…'sat', at: 'HH:MM' }`   on the wall clock of the host's zone;
 *   - `{ everyMs: <ms>, from: <ISO> }`                   a plain interval;
 *   - `{ event: { kind: 'added'|'changed'|'any', type?, circleId?, field? } }`   when an item the host holds is
 *     added, changed (with `field`, only that field) or either — once per change. A household-level row always
 *     names its `circleId`; a row without one is a person's own, over their own-devices scope only.
 * A trigger outside it has no occurrences. The verbs are the task lifecycle's; the type is its own, so no chore list
 * ever shows a machine row.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const INTENTION_SCHEMA = {
  iri:         `${NAMESPACE}Intention`,
  description: 'Pending work: a waist call (op, appOrigin, args) to run as a person when a trigger fires.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'trigger', 'op', 'actsAs'],
  properties: {
    ...BASE_PROPERTIES,
    type:      { const: 'intention' },
    trigger:   { type: 'object' },
    op:        { type: 'string', minLength: 1 },
    appOrigin: { type: 'string', minLength: 1 },
    args:      { type: 'object' },
    actsAs:    { type: 'string', minLength: 1 },
    label:     { type: 'string' },
    // how late an occurrence may still run: 'day' (the rest of its day) or milliseconds; absent = the trigger's default
    window:    {},
    lastRunAt: {},
    state:     { type: 'string', enum: ['open', 'done', 'cancelled'] },
  },
};
