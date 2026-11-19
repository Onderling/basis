/**
 * A FENCE on what the person's own "+" offers, by an op's WEIGHT (ledger L977; `opWeight`, from the verb and
 * `writes: { scope, what }`): nothing above the ceiling (3 until the ceiling per persona is a setting: own things, and
 * a circle's through the card), nothing that has no weight. A 4 or 5 (who reaches what) is only ever pointed to on its
 * settings screen; a 6 (keys) is never offered there at all. The older marks (group `admin`/`device`, visibility, a
 * confirmation) decide nothing here any more: the weight is the one answer.
 */
import { describe, it, expect } from 'vitest';
import { ownPlaceCatalogue, withinWeight, PLUS_CEILING } from '../../src/assistant/plusDoor.js';
import { opWeight } from '@onderling/app-manifest';

describe('the "+" offers nothing heavier than its ceiling', () => {
  it('every op it offers has a weight, and none is above the ceiling', () => {
    const { catalogue, manifestsByOrigin } = ownPlaceCatalogue({});
    const heavy = [...catalogue.opsById.values()]
      .map((e) => [`${e.appOrigin}.${e.op.id}`, opWeight(manifestsByOrigin[e.appOrigin], e.op)])
      .filter(([, w]) => w === null || w > PLUS_CEILING);
    expect(heavy).toEqual([]);
    expect(PLUS_CEILING).toBe(3);
  });

  it('the fence bites: a heavier op, or one with no weight, is cut; a read and the lighter writes stay', () => {
    const m = { app: 'x', operations: [] };
    const op = (id, writes, extra = {}) => ({ id, verb: writes ? 'add' : 'list', ...(writes ? { writes } : {}), ...extra });
    const ops = [
      op('readIt'), op('myNote', { scope: 'person', what: 'content' }), op('theirTask', { scope: 'circle', what: 'content' }),
      op('myExposure', { scope: 'person', what: 'control' }), op('removeMember', { scope: 'circle', what: 'control' }),
      op('newKey', { scope: 'device', what: 'keys' }), op('offer', null, { reveals: 'keys' }), op('undeclared', { scope: 'circle' }),
    ];
    const catalogue = { opsById: new Map(ops.map((o) => [o.id, { appOrigin: 'x', op: o }])) };
    const kept = (ceiling) => [...withinWeight(catalogue, { x: m }, ceiling).opsById.keys()];
    expect(kept(3)).toEqual(['readIt', 'myNote', 'theirTask']);
    expect(kept(1)).toEqual(['readIt']);
    expect(kept(0)).toEqual([]);                       // hidden: nothing at all
  });
});
