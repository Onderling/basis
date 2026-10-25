/**
 * `group-rules` type — a circle's RULES HEAD: the rules document a device holds for a circle, at the version it last
 * applied.
 *
 * Written only by the circle's creation, the join (the invite carries the rules, mirrored here) and the rules lane's
 * apply (a signed `rules-update` statement from an admin, highest version wins). It is this device's applied view, so it
 * is never carried by the generic store door: the task lane refuses it, or any member's write would ride past the rules
 * lane's receiver-side admin check.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const GROUP_RULES_SCHEMA = {
  iri:         `${NAMESPACE}GroupRules`,
  description: "A circle's rules head: the rules document at the version this device last applied.",
  type:        'object',
  required:    [...BASE_REQUIRED, 'source'],
  properties: {
    ...BASE_PROPERTIES,
    type:   { const: 'group-rules' },
    text:   { type: 'string', description: "the circle's name, as the rules name it" },
    source: {
      type:       'object',
      required:   ['groupId'],
      properties: {
        groupId:   { type: 'string', minLength: 1, description: 'the circle these rules are for' },
        rules:     { type: 'object', description: 'the rules document (purpose, admins, house rules, the invite and storage settings)' },
        version:   { type: 'number', description: 'its version: monotonic, the highest applied wins' },
        mirrored:  { type: 'boolean', description: 'true when it arrived (the join, a rules-update), not written here' },
        updatedBy: { type: 'string', description: "the verified admin author of the rules-update it was applied from" },
        statement: { description: 'the original signed rules-update statement, kept so it can be served at catch-up' },
      },
    },
  },
};
