/**
 * WHOSE ITEM IT IS BINDS ON EVERY DEVICE (L1141 design: each item type declares who may change and remove a row).
 * Before: any member's device could change or remove another member's row wherever the circle allowed the act at all;
 * the receiving rails asked nothing about whose it was, and took the maker from a field inside the snapshot. Now, on
 * each receiving device: a row's maker is the verified author of the statement that added it; a change must keep it;
 * for an 'author' type a change or a removal is taken only from the maker or an admin; a 'circle' type takes any member.
 * The sender here is a CHANGED one (its own app asks nothing), so only the receivers decide.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog } from '../../src/eventLog.js';
import { makeItemsRail, makeItemsEmitter, makeItemsPeerHandler, routeItemsMirror, ITEMS_BROADCAST } from '../../src/v2/itemsRail.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const CIRCLE = 'circle:whose';
// the declarations this test runs under (the real ones live on the types)
const DECLARED = { note: 'author', task: 'circle' };
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

const ROSTER = () => [{ webid: 'webid:ada', role: 'member' }, { webid: 'webid:xavi', role: 'member' }, { webid: 'webid:yara', role: 'admin' }];

function freshStores(makerFor) {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  return createCircleStores({ dataSource: memoryDataSource(), registry, makerFor });
}

/** One device: its own log, its own store; `open()` says whether the circle's store is open yet (it peeks, as the agent's does). */
async function device(ref, roster, wire, { eventLog = new EventLog({ initial: [], muted: [] }), identity = null, open = () => true } = {}) {
  const cid = identity ?? await AgentIdentity.generate(new VaultMemory());
  const row = roster.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  let rail = null;
  const stores = freshStores((circleId) => rail?.selfRefFor(circleId) ?? null);   // the shells' wiring: one function
  rail = makeItemsRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async (app, op) => (app === 'pinboard' && op === 'listGroupMembers' ? { members: roster.map((m) => ({ ...m })) } : {}),
    storeFor: (circleId) => (open() ? stores.getStore(circleId) : null),
    verifyBinding: async ({ author, ref: r }) => roster.some((m) => m.circleAddress === author && m.webid === r),
    judge: { manifests: () => allManifests() },
    changedByOf: (type) => DECLARED[type],
  });
  const emitter = makeItemsEmitter({ rail, fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }) });
  const store = stores.getStore(CIRCLE);
  wireStoreMirror(store, routeItemsMirror({ circleId: CIRCLE, emitter }));
  return { ref, cid, eventLog, store, rail, receiver: makeItemsPeerHandler({ rail }) };
}

async function deliver(statements, to) {
  for (const w of statements) {
    if (w.from === to.ref) continue;
    await to.receiver(null, { subtype: ITEMS_BROADCAST, circleId: w.circleId, event: w.statement });
  }
  await settle();
}


async function three() {
  const roster = ROSTER();
  const wire = [];
  const ada = await device('webid:ada', roster, wire);     // the changed sender
  const xavi = await device('webid:xavi', roster, wire);   // a member: the maker of the rows
  const yara = await device('webid:yara', roster, wire);   // an admin
  return { roster, wire, ada, xavi, yara };
}
const flush = async (wire, ...to) => { const w = wire.splice(0); for (const d of to) await deliver(w, d); };

describe('whose item it is, judged by each receiving device', () => {
  it('a member changes and removes another member\'s NOTE: refused on the maker\'s device and on the admin\'s', async () => {
    const { wire, ada, xavi, yara } = await three();
    const note = await xavi.store.put({ type: 'note', text: 'mine', body: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    expect((await yara.store.get(note.id))?.madeBy).toBe('webid:xavi');
    await ada.store.put({ ...(await ada.store.get(note.id)), text: 'ada was here' }, { by: 'webid:ada' });
    await settle(); await flush(wire, xavi, yara);
    expect((await xavi.store.get(note.id)).text).toBe('mine');
    expect((await yara.store.get(note.id)).text).toBe('mine');
    await ada.store.delete(note.id);
    await settle(); await flush(wire, xavi, yara);
    expect(await xavi.store.get(note.id)).not.toBeNull();
    expect(await yara.store.get(note.id)).not.toBeNull();
  });

  it('the same on a TASK (a circle type): taken', async () => {
    const { wire, ada, xavi, yara } = await three();
    const task = await xavi.store.put({ type: 'task', text: 'boodschappen' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    await ada.store.put({ ...(await ada.store.get(task.id)), text: 'boodschappen gedaan' }, { by: 'webid:ada' });
    await settle(); await flush(wire, xavi, yara);
    expect((await xavi.store.get(task.id)).text).toBe('boodschappen gedaan');
    expect((await yara.store.get(task.id)).madeBy, 'the maker stays').toBe('webid:xavi');
  });

  it('an admin\'s change and removal of a member\'s note: taken', async () => {
    const { wire, ada, xavi, yara } = await three();
    const note = await xavi.store.put({ type: 'note', text: 'mine', body: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    await yara.store.delete(note.id);
    await settle(); await flush(wire, ada, xavi);
    expect(await xavi.store.get(note.id)).toBeNull();
    expect(await ada.store.get(note.id)).toBeNull();
  });

  it('a new row naming another maker is kept under its real author; a change that renames the maker is refused', async () => {
    const { wire, ada, xavi, yara } = await three();
    await ada.store.put({ id: 'n-forged', type: 'note', text: 'xavi said so', body: 'x', madeBy: 'webid:xavi' }, { by: 'webid:ada' });
    await settle(); await flush(wire, xavi, yara);
    expect((await yara.store.get('n-forged'))?.madeBy, 'the verified author, not the claimed one').toBe('webid:ada');
    const task = await xavi.store.put({ type: 'task', text: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    expect((await ada.store.get(task.id)).madeBy).toBe('webid:xavi');
    await ada.store.put({ ...(await ada.store.get(task.id)), madeBy: 'webid:ada', text: 'now mine' }, { by: 'webid:ada' });
    await settle(); await flush(wire, xavi, yara);
    expect((await yara.store.get(task.id)).madeBy).toBe('webid:xavi');
    expect((await yara.store.get(task.id)).text).toBe('mine');
  });

  it('the maker\'s own device and every receiver hold the same maker (one function stamps and signs)', async () => {
    const { wire, ada, xavi, yara } = await three();
    const note = await xavi.store.put({ type: 'note', text: 'mine', body: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    const held = (await xavi.store.get(note.id)).madeBy;
    expect(held).toBe(xavi.rail.selfRefFor(CIRCLE));
    expect((await ada.store.get(note.id)).madeBy).toBe(held);
    expect((await yara.store.get(note.id)).madeBy).toBe(held);
  });

  it('a change that carries NO maker keeps the held one', async () => {
    const { wire, ada, xavi, yara } = await three();
    const task = await xavi.store.put({ type: 'task', text: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    const { madeBy, ...noMaker } = await ada.store.get(task.id);
    await ada.store.put({ ...noMaker, text: 'changed' }, { by: 'webid:ada' });
    await settle(); await flush(wire, xavi, yara);
    expect((await yara.store.get(task.id)).text).toBe('changed');
    expect((await yara.store.get(task.id)).madeBy).toBe(madeBy);
  });

  it('an admin\'s removal stays removed after the admin is demoted, also when the store is opened again', async () => {
    const { roster, wire, ada, xavi, yara } = await three();
    const note = await xavi.store.put({ type: 'note', text: 'mine', body: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    await yara.store.delete(note.id);                 // yara is an admin: taken
    await settle(); await flush(wire, ada, xavi);
    expect(await ada.store.get(note.id)).toBeNull();
    roster.find((m) => m.webid === 'webid:yara').role = 'member';   // demoted
    await ada.rail.rebuildHead(CIRCLE);               // the store opens again: everything is re-applied
    await settle();
    expect(await ada.store.get(note.id), 'the removal stands').toBeNull();
  });

  it('a removal made AFTER the demotion is refused', async () => {
    const { roster, wire, ada, xavi, yara } = await three();
    const note = await xavi.store.put({ type: 'note', text: 'mine', body: 'mine' }, { by: 'webid:xavi' });
    await settle(); await flush(wire, ada, yara);
    roster.find((m) => m.webid === 'webid:yara').role = 'member';
    await yara.store.delete(note.id);
    await settle(); await flush(wire, ada, xavi);
    expect(await ada.store.get(note.id)).not.toBeNull();
  });
});
