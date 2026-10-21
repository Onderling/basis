/**
 * `chat-thread` type — a named conversation container that holds
 * `chat-message` items (a `chat-message` carries the `threadId` of
 * the thread it belongs to).
 *
 * Canonical companion to `chat-message` (#81): basis's shell
 * declares both `chat-thread` + `chat-message` on its manifest
 * surface, so both must resolve in the shared `@onderling/item-types`
 * registry for the manifest to validate clean under `{strictNouns}`.
 *
 * Shape mirrors basis's ThreadStore thread object: a required `name`, an
 * optional `filter` (which apps / event-types / actors the thread
 * subscribes to), and optional `permissions`.  `additionalProperties`
 * stays open (forward-additive policy) so bespoke thread fields
 * (e.g. `allowCommands`) don't invalidate.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CHAT_THREAD_SCHEMA = {
  iri:         `${NAMESPACE}ChatThread`,
  description: 'A named conversation container that holds chat-message items.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'name'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'chat-thread' },
    name:        { type: 'string', minLength: 1 },
    // The thread's subscription filter — which apps / event-types /
    // actors it surfaces.  An absent slot means "accept all" (the
    // wildcard convention).
    filter: {
      type: 'object',
      properties: {
        apps:       { type: 'array', items: { type: 'string' } },
        eventTypes: { type: 'array', items: { type: 'string' } },
        actors:     { type: 'array', items: { type: 'string' } },
      },
    },
    // Per-thread permissions (who may post / command).  Shape is
    // app-owned; left open here.
    permissions: { type: 'object' },
  },
};
