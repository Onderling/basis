/**
 * A LATER STATEMENT OF A ROW IS THE ACT THE STATEMENTS BEFORE IT MAKE IT, NOT THE ACT IT WAS WHEN IT ARRIVED.
 *
 * The act a snapshot arrived as (an add of a row not held, a change of a held one) is kept on the device log, because
 * for a row's FIRST statement on this log nothing older can say it. For every later statement of the row the act
 * follows from the allowed statements before it: when the add before a change is taken back, that change is an add
 * of a row this device no longer holds, and is judged as one.
 *
 * Two receiving devices, one order apart. X gets the add and then a change of one task before the switch-off (adding
 * off, changing on); Y gets the switch-off first. Both must end without the row: Y refuses both statements as adds;
 * X takes the add back when the switch-off arrives, and with it the change. A restart of X (the re-apply from the log
 * when the store opens) must not bring it back either.
 *
 * Over the real items rail, a real device log (`EventLog`) and real signed statements written by a sender's store.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, frontier } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog } from '../../src/eventLog.js';
import { makeItemsRail, makeItemsEmitter, makeItemsPeerHandler, routeItemsMirror, ITEMS_BROADCAST } from '../../src/v2/itemsRail.js';
import { noteKeptPolicyChanges } from '../../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const CIRCLE = 'circle:later-act';
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

const ROSTER = () => [{ webid: 'webid:ada', role: 'member' }, { webid: 'webid:xavi', role: 'member' }, { webid: 'webid:yara', role: 'admin' }];

function freshStores() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

/** One device: its own log, its own store; `open()` says whether the circle's store is open yet (it peeks, as the agent's does). */
async function device(ref, roster, wire, { eventLog = new EventLog({ initial: [], muted: [] }), identity = null, open = () => true } = {}) {
  const cid = identity ?? await AgentIdentity.generate(new VaultMemory());
  const row = roster.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const stores = freshStores();
  const rail = makeItemsRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async (app, op) => (app === 'pinboard' && op === 'listGroupMembers' ? { members: roster.map((m) => ({ ...m })) } : {}),
    storeFor: (circleId) => (open() ? stores.getStore(circleId) : null),
    verifyBinding: async ({ author, ref: r }) => roster.some((m) => m.circleAddress === author && m.webid === r),
    judge: { manifests: () => allManifests() },
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

/** A kept settings change at `version`, its items line drawn at what `onDevice` holds now. */
function change(version, policy, onDevice) {
  const items = onDevice ? frontier(onDevice.rail.storedStatements(CIRCLE).map((s) => s.body)) : [];
  return { kind: POLICY_UPDATE_KIND, author: 'admin', hash: `p${version}`, payload: { policy, version, contentUpTo: { items, chat: [] } } };
}
const ON = {};
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };

describe('a later statement of a row is judged by the statements before it', () => {
  it('the add is taken back: the change after it goes too, on the device that had both and the one that had neither, also after a restart', async () => {
    const roster = ROSTER();
    const wire = [];
    const ada = await device('webid:ada', roster, wire);    // a sender whose own app does not judge
    const x = await device('webid:xavi', roster, wire);
    const y = await device('webid:yara', roster, wire);
    const v1 = change(1, ON, null);
    for (const d of [x, y]) noteKeptPolicyChanges(d.eventLog, CIRCLE, [v1]);
    // the switch-off, its line drawn before the row was made (it raced the change)
    const v2 = change(2, ADD_OFF, y);
    noteKeptPolicyChanges(y.eventLog, CIRCLE, [v1, v2]);

    const [row] = await addTasks(ada.store, [{ text: 'made' }], { actor: 'webid:ada' });
    await settle();
    await ada.store.put({ ...(await ada.store.get(row.id)), text: 'changed' }, { by: 'webid:ada' });
    await settle();
    const sent = wire.splice(0);
    expect(sent.length, 'the add and the change, signed and fanned').toBe(2);

    await deliver(sent, x);
    expect((await x.store.get(row.id))?.text, 'X applied both before the switch-off reached it').toBe('changed');
    await deliver(sent, y);
    expect(await y.store.get(row.id), 'Y: both arrived after the switch-off, both adds of a row it does not hold').toBeFalsy();

    noteKeptPolicyChanges(x.eventLog, CIRCLE, [v1, v2]);
    await settle();
    expect(await x.store.get(row.id), 'X: the add is taken back, and the change after it is an add of a row no longer held').toBeFalsy();

    // a restart: the same log, the store re-applied from it when the circle opens
    await x.rail.rebuildHead(CIRCLE);
    expect(await x.store.get(row.id), 'the re-apply on the same store does not bring it back').toBeFalsy();
    const xAgain = await device('webid:xavi', roster, [], { eventLog: x.eventLog, identity: x.cid });
    await xAgain.rail.rebuildHead(CIRCLE);
    expect(await xAgain.store.get(row.id), 'a restart into an empty store does not bring it back').toBeFalsy();
  });

  it('a statement that arrived while the store was not open is applied when it opens, in a judged circle too', async () => {
    const roster = ROSTER();
    const wire = [];
    const ada = await device('webid:ada', roster, wire);
    let open = false;
    const x = await device('webid:xavi', roster, wire, { open: () => open });
    noteKeptPolicyChanges(x.eventLog, CIRCLE, [change(1, ON, null)]);
    const [row] = await addTasks(ada.store, [{ text: 'while closed' }], { actor: 'webid:ada' });
    await settle();
    await ada.store.put({ ...(await ada.store.get(row.id)), text: 'changed while closed' }, { by: 'webid:ada' });
    await settle();
    await deliver(wire.splice(0), x);
    expect((await x.rail.readVerifiedBodies(CIRCLE)).bodies.length, 'on the log').toBe(2);
    expect(await x.store.get(row.id), 'nowhere to land yet').toBeFalsy();
    open = true;
    expect(await x.rail.rebuildHead(CIRCLE)).toBeGreaterThan(0);
    expect((await x.store.get(row.id))?.text).toBe('changed while closed');
    await x.rail.rebuildHead(CIRCLE);
    expect((await x.store.get(row.id))?.text, 'idempotent').toBe('changed while closed');
  });
});
