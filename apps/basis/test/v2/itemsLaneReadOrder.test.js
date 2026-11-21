/**
 * THE ITEMS LANE TAKES ITS STATEMENTS IN THE ORDER THEY ARRIVED, NOT THE ORDER THE LOG READS.
 *
 * The device log (`EventLog`) reads most-recent-first; a minimal log (a test's) reads oldest-first. A pass that takes
 * "first", "last" or the reading order of a row's statements as time order is right on one and wrong on the other.
 *
 * - The re-apply when a store opens, on a circle no switch judges (and on the person's own lane, which is never
 *   judged): a row added and then removed while the store was not open must stay removed. Taken in the log's reading
 *   order, the remove came first (nothing to remove) and the add after it put the row back.
 * - `inArrivalOrder`: every statement with a place on the log by its place; one without a place (a minimal log) after
 *   them, in the order it reads. One consistent order whatever the mix.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog } from '../../src/eventLog.js';
import { makeItemsRail, makeItemsEmitter, makeItemsPeerHandler, routeItemsMirror, ITEMS_BROADCAST, inArrivalOrder } from '../../src/v2/itemsRail.js';

const CIRCLE = 'circle:read-order';
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function freshStores() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

async function device(ref, roster, wire, { open = () => true } = {}) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  roster.find((m) => m.webid === ref).circleAddress = cid.pubKey;
  const eventLog = new EventLog({ initial: [], muted: [] });
  const stores = freshStores();
  const rail = makeItemsRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async () => ({}),
    storeFor: (circleId) => (open() ? stores.getStore(circleId) : null),
    verifyBinding: async ({ author, ref: r }) => roster.some((m) => m.circleAddress === author && m.webid === r),
  });
  const emitter = makeItemsEmitter({ rail, fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }) });
  const store = stores.getStore(CIRCLE);
  wireStoreMirror(store, routeItemsMirror({ circleId: CIRCLE, emitter }));
  return { ref, eventLog, store, rail, receiver: makeItemsPeerHandler({ rail }) };
}

describe('the items lane reads its statements in arrival order', () => {
  it('a row added and removed while the store was closed stays removed when it opens (no judge, a real device log)', async () => {
    const roster = [{ webid: 'webid:ada' }, { webid: 'webid:xavi' }];
    const wire = [];
    const ada = await device('webid:ada', roster, wire);
    let open = false;
    const x = await device('webid:xavi', roster, wire, { open: () => open });
    const [row] = await addTasks(ada.store, [{ text: 'made, then removed' }], { actor: 'webid:ada' });
    await settle();
    await ada.store.delete(row.id, { by: 'webid:ada' });
    await settle();
    const sent = wire.splice(0);
    expect(sent.map((w) => w.statement.body.kind), 'the add and the remove, signed and fanned').toEqual(['snapshot', 'remove']);
    for (const w of sent) await x.receiver(null, { subtype: ITEMS_BROADCAST, circleId: w.circleId, event: w.statement });
    await settle();
    const read = (await x.rail.readVerifiedBodies(CIRCLE)).bodies.map((b) => b.kind);
    expect(read, 'the device log reads most-recent-first').toEqual(['remove', 'snapshot']);
    open = true;
    await x.rail.rebuildHead(CIRCLE);
    expect(await x.store.get(row.id), 'the remove came after the add').toBeFalsy();
  });

  it('inArrivalOrder: placed by place, the unplaced after them in reading order, one order for any mix', () => {
    const b = (name, atSeq) => ({ name, ...(atSeq === undefined ? {} : { atSeq }) });
    const names = (xs) => inArrivalOrder(xs).map((x) => x.name);
    // a real log: newest first, every one placed
    expect(names([b('c', 3), b('b', 2), b('a', 1)])).toEqual(['a', 'b', 'c']);
    // a minimal log: no places, its reading order kept
    expect(names([b('a'), b('b'), b('c')])).toEqual(['a', 'b', 'c']);
    // a mix: the placed by place, then the unplaced as they read; the same answer from any starting order of the placed
    expect(names([b('c', 3), b('u1'), b('a', 1), b('u2'), b('b', 2)])).toEqual(['a', 'b', 'c', 'u1', 'u2']);
    expect(names([b('u1'), b('b', 2), b('u2'), b('a', 1), b('c', 3)])).toEqual(['a', 'b', 'c', 'u1', 'u2']);
    // equal places keep their reading order
    expect(names([b('y', 5), b('x', 5)])).toEqual(['y', 'x']);
  });
});
