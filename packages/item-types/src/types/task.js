/**
 * `task` type — a shared circle task with optional dependencies +
 * DoD lifecycle. Owned by the Tasks app but expressed in
 * substrate-shared terms.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const TASK_SCHEMA = {
  iri:         `${NAMESPACE}Task`,
  description: 'A shared circle task. May reference other items via embeds + dependencies.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'text'],
  properties: {
    ...BASE_PROPERTIES,
    type:         { const: 'task' },
    text:         { type: 'string', minLength: 1 },
    status:       {
      type: 'string',
      enum: [
        'ready', 'waiting', 'blocked', 'claimed',
        'submitted', 'approved', 'rejected', 'revoked',
        'completed',
      ],
    },
    // Assignment. `assignee` (singular) is the MIRROR of `assignees[0]` kept for
    // backward-compatible reads; `assignees[]` is the authoritative co-owner set
    // and `maxAssignees` (default 1 ⇒ exclusive; >1 or null ⇒ co-ownable) caps it.
    assignee:     { type: 'string' },
    assignees:    { type: 'array', items: { type: 'string' } },
    maxAssignees: { type: ['integer', 'null'], minimum: 1 },
    dependencies: { type: 'array', items: { type: 'string' } },
    circleId:       { type: 'string' },
    dod:          { type: 'string' },
    approver:     { type: 'string' },
    // ── G-DICT catch-up: fields the lifecycle verbs read/write that the canonical schema had drifted BEHIND
    // (the homes plan Part III dictionary catch-up). Left UNCONSTRAINED (accept any) on purpose: the schema's
    // job here is to DECLARE these fields exist (so a schema-validating consumer no longer rejects a real item
    // that carries them, and "declare a noun → get CRUD" is complete), NOT to police their shape. The runtime
    // writes several of them inconsistently across call sites — timestamps as epoch numbers OR ISO strings OR
    // null, `requiredSkills` as an array OR a comma-string — so a strict type would either re-introduce the
    // rejection bug or hit Ajv strict-mode's no-multi-data-type-union rule. `requiredSkills` is the field the
    // hybrid-dispatch product idea depends on; `deliverable` is the Definition-of-Done artefact. Tighten a
    // field to a single canonical type once the runtime normalises to one (a separate normalisation debt).
    requiredSkills: {}, deliverable: {},
    claimedAt: {}, completedAt: {}, submittedAt: {}, dueAt: {}, addedAt: {},
    addedBy: {}, addedByDisplayName: {}, parentTaskId: {}, note: {}, notes: {}, reviewLog: {},
  },
};
