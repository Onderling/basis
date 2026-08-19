/**
 * `chat-message` type — a single chat message in a thread.
 * Shared across Stoop's circle chat + Tasks's appeal flow +
 * any future chat-bearing app.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const CHAT_MESSAGE_SCHEMA = {
  iri:         `${NAMESPACE}ChatMessage`,
  description: 'A single chat message in a thread.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'body'],
  properties: {
    ...BASE_PROPERTIES,
    type:        { const: 'chat-message' },
    threadId:    { type: 'string' },
    body:        { type: 'string' },
    attachments: { type: 'array', items: { type: 'object' } },
  },
};
