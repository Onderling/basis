/**
 * Base properties + required fields shared by every item type.
 *
 * Every item carries:
 *   - `type` (string, constrained per-schema to a single value)
 *   `id` (string, URI-shaped after)
 *   - `createdAt` (ISO timestamp)
 *   - `createdBy` (agent URI)
 *   - `updatedAt` (ISO timestamp, optional)
 *   - `updatedBy` (agent URI, optional)
 *   - `embeds` (array of {type, ref}, optional — see embedsSchema.js)
 *
 * Type-specific schemas spread `BASE_PROPERTIES` into their own
 * `properties` and append their own `BASE_REQUIRED` entries.
 *
 * `additionalProperties: true` (the default in JSON Schema) is
 * left in place across the board so apps can add forward-compat
 * fields without invalidating items written by older clients —
 * see plan §C 2026-05-11 changelog entry for the
 * forward-additive-only versioning policy.
 */

import { EMBEDS_SCHEMA } from './embedsSchema.js';

export const BASE_PROPERTIES = Object.freeze({
  type:      { type: 'string', minLength: 1 },
  id:        { type: 'string', minLength: 1 },
  createdAt: { type: 'string', format: 'date-time' },
  createdBy: { type: 'string', minLength: 1 },
  updatedAt: { type: 'string', format: 'date-time' },
  updatedBy: { type: 'string', minLength: 1 },
  embeds:    EMBEDS_SCHEMA,
});

export const BASE_REQUIRED = Object.freeze(['type', 'id', 'createdAt', 'createdBy']);

/** Project namespace for type IRIs. */
export const NAMESPACE = 'https://onderling.org/ns#';
