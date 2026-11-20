/**
 * A CIRCLE'S SWITCHES BIND ON EVERY MEMBER'S DEVICE, ON THE ITEMS LANE.
 *
 * The sender's gate binds only the sender's app. Here a changed sender (its app ignores the switch) writes tasks; the
 * receiving device judges each arrived statement by the settings at its place on the content line (`contentLine.js`):
 * what was made before a switch-off stays, what was made after is refused, a statement that raced the change is taken
 * back when the change arrives, and a later ALLOWED change of the same row survives that take-back. The settings changes
 * are the ones the settings lane kept, noted per device; at a quiet start the rail asks the lane for them.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, frontier } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeItemsRail, makeItemsEmitter, makeItemsPeerHandler, routeItemsMirror, ITEMS_BROADCAST } from '../../src/v2/itemsRail.js';
import { noteKeptPolicyChanges, provideKeptPolicyChanges } from '../../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const CIRCLE = 'circle:switches';
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry); return entry;
    },
  };
}

async function device(ref, rosterAll, wire, { stores = null } = {}) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const held = stores ?? createCircleStores({ dataSource: memoryDataSource(), registry });
  const eventLog = fakeEventLog();
  const rail = makeItemsRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async (app, op) => (app === 'pinboard' && op === 'listGroupMembers' ? { members: rosterAll.map((m) => ({ ...m })) } : {}),
    storeFor: (circleId) => held.getStore(circleId),
    verifyBinding: async ({ author, ref: r }) => rosterAll.some((m) => m.circleAddress === author && m.webid === r),
    judge: { manifests: () => allManifests() },
  });
  const emitter = makeItemsEmitter({ rail, fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }) });
  const store = held.getStore(CIRCLE);
  wireStoreMirror(store, routeItemsMirror({ circleId: CIRCLE, emitter }));
  return { ref, eventLog, store, stores: held, rail, receiver: makeItemsPeerHandler({ rail }) };
}

async function deliver(wire, to) {
  while (wire.length) {
    const w = wire.shift();
    if (w.from === to.ref) continue;
    await to.receiver(null, { subtype: ITEMS_BROADCAST, circleId: w.circleId, event: w.statement });
  }
  await settle();
}

/** A kept settings change at `version` with the items line drawn at what `onDevice` holds now. */
function change(version, policy, onDevice, hash = `p${version}`) {
  const items = onDevice ? frontier(onDevice.rail.storedStatements(CIRCLE).map((s) => s.body)) : [];
  return { kind: POLICY_UPDATE_KIND, author: 'admin', hash, payload: { policy, version, contentUpTo: { items, chat: [] } } };
}
const ON = {};
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const changeAtoms = () => allManifests().find((m) => m.app === 'tasks').nouns.task.atoms.filter((a) => !['add', 'list', 'remove'].includes(a));
const CHANGES_OFF = () => ({ capabilities: Object.fromEntries(changeAtoms().map((a) => [`tasks ${a} task`, { enabled: false }])) });

async function circle() {
  const rosterAll = [{ webid: 'webid:ada', role: 'member' }, { webid: 'webid:bo', role: 'admin' }];
  const wire = [];
  const ada = await device('webid:ada', rosterAll, wire);   // the changed sender: its own app does not judge
  const bo = await device('webid:bo', rosterAll, wire);     // the receiving member
  return { rosterAll, wire, ada, bo };
}

describe('the items lane judges what it applies', () => {
  it('made before the switch-off stays; made after is refused on the receiving device', async () => {
    const { wire, ada, bo } = await circle();
    const v1 = change(1, ON, null);
    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1]);
    const [before] = await addTasks(ada.store, [{ text: 'before the switch' }], { actor: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    expect((await bo.store.get(before.id))?.text).toBe('before the switch');

    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1, change(2, ADD_OFF, bo)]);
    await settle();
    expect((await bo.store.get(before.id))?.text, 'behind the line: stays').toBe('before the switch');

    const [after] = await addTasks(ada.store, [{ text: 'after the switch' }], { actor: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    expect(await bo.store.get(after.id), 'an add after the switch-off is not applied').toBeFalsy();
    expect(bo.eventLog.entries.some((e) => e.payload?.body?.subject === after.id), 'but kept on the log').toBe(true);
  });

  it('a statement that raced the switch-off is taken back when the change arrives', async () => {
    const { wire, ada, bo } = await circle();
    const v1 = change(1, ON, null);
    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1]);
    // the admin draws the line before the race: what bo holds now (nothing of ada's yet)
    const v2 = change(2, ADD_OFF, bo);
    const [raced] = await addTasks(ada.store, [{ text: 'raced' }], { actor: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    expect((await bo.store.get(raced.id))?.text, 'applied while the change had not arrived').toBe('raced');
    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1, v2]);
    await settle();
    expect(await bo.store.get(raced.id), 'taken back: an add after the line').toBeFalsy();
    // …and a restart (the re-apply when the store opens) does not bring it back
    await bo.rail.rebuildHead(CIRCLE);
    expect(await bo.store.get(raced.id)).toBeFalsy();
  });

  it('taking back a refused change keeps a LATER allowed change of the same row', async () => {
    const { wire, ada, bo } = await circle();
    const v1 = change(1, ON, null);
    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1]);
    const [row] = await addTasks(ada.store, [{ text: 'first' }], { actor: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    const v2 = change(2, CHANGES_OFF(), bo);                       // changes off, drawn after the row was made
    await ada.store.put({ ...(await ada.store.get(row.id)), text: 'refused edit' }, { by: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    const v3 = change(3, ON, bo);                                  // changes on again, drawn after the refused edit
    await ada.store.put({ ...(await ada.store.get(row.id)), text: 'allowed edit' }, { by: 'webid:ada' });
    await settle(); await deliver(wire, bo);
    expect((await bo.store.get(row.id))?.text).toBe('allowed edit');
    noteKeptPolicyChanges(bo.eventLog, CIRCLE, [v1, v2, v3]);
    await settle();
    expect((await bo.store.get(row.id))?.text, 'the later allowed change survives the take-back').toBe('allowed edit');
  });

  it('a quiet start: not known yet, the rail asks the settings lane, and the parked statement is applied', async () => {
    const { wire, ada, bo } = await circle();
    let asked = 0;
    provideKeptPolicyChanges(bo.eventLog, async (cid) => { asked += 1; noteKeptPolicyChanges(bo.eventLog, cid, [change(1, ON, null)]); });
    const [t] = await addTasks(ada.store, [{ text: 'while bo started' }], { actor: 'webid:ada' });
    await settle(); await deliver(wire, bo); await settle();
    expect(asked).toBe(1);
    expect((await bo.store.get(t.id))?.text, 'parked, then applied once the lane answered').toBe('while bo started');
  });
});
