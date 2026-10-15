/**
 * `device-link` type — one of the person's devices, by the wire id its DEFAULT persona knows it as, and its internal id.
 *
 * Each persona knows a device by a wire id derived from the persona's own seed over the device's internal id, so no two
 * personas' records link (by design). The person's revoke ceremony must still retire a lost device under every persona
 * it held: it derives each persona's wire id for the device from the internal id it finds here. A row lives ONLY in
 * the person's own-devices scope (sealed, synced between their own devices) — never in a circle, never on a roster,
 * never inside a signed delegation record. Each device writes its own row.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const DEVICE_LINK_SCHEMA = {
  iri:         `${NAMESPACE}DeviceLink`,
  description: 'A device of the person: its default wire id and its internal id (own-devices scope only).',
  type:        'object',
  required:    [...BASE_REQUIRED, 'wireId', 'internalId'],
  properties: {
    ...BASE_PROPERTIES,
    type:       { const: 'device-link' },
    wireId:     { type: 'string', minLength: 1 },
    internalId: { type: 'string', minLength: 1 },
  },
};
