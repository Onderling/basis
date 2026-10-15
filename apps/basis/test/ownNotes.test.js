/**
 * A person's own notes (of no circle) are `note` items in their OWN store — the own-devices scope, carried to their
 * other devices and never to a circle's members — reached by the same generic note ops a circle's notes use, with the
 * own scope named as the circle. Vandaag's notes block shows them beside the circles' notes, untagged by a circle.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../src/v2/grantsManifest.js';
import { materializeScreen } from '../src/v2/userScreenBlocks.js';

const op = (atom) => encodeGenericOpId('household', atom, 'note');

describe("a person's own notes", () => {
  it('land in the own store, and only there', async () => {
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'sleutel bij de buren' });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    const stored = await createOwnDevicesStore({ dataSource: ds }).listByType('note');
    expect(stored.map((n) => n.body)).toEqual(['sleutel bij de buren']);
    // never a household circle store named after the scope
    expect(a.householdService?.stores?.has?.(OWN_DEVICES_SCOPE) ?? false).toBe(false);
    const listed = await a.callSkill('household', op('list'), { circleId: OWN_DEVICES_SCOPE });
    expect((listed?.items ?? []).map((i) => i.text)).toEqual(['sleutel bij de buren']);
  });

  it('show on a notes block beside the circles\' notes, with no circle', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: memoryDataSource() }) });
    await a.callSkill('household', op('add'), { circleId: OWN_DEVICES_SCOPE, body: 'eigen briefje' });
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'n', type: 'notes', config: {} }] },
      hostOps: { callSkill: (app, o, g) => a.callSkill(app, o, g), circles: [] },
    });
    expect(block.content.items.map((r) => [r.label, r.circleId])).toEqual([['eigen briefje', null]]);
  });
});
