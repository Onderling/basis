/**
 * A HEAD SERVED IN ANSWER TO A CATCH-UP IS NOT AN ACT. Items statements age out while the store row lives on, so a
 * device that was away, or a joiner, gets older rows as fresh snapshots signed by whoever serves them. Judged as an
 * `add` behind no settings line, such a head would be refused wherever adding is off: a joiner would miss every
 * existing row of that type while old members keep theirs. So:
 *   - the serving device marks a synthesized head `served: true` INSIDE the signed body (who served it is proven; an
 *     author's own statement never carries it);
 *   - the catch-up remembers which circles this device asked of which peer (until the batch, or a timeout) and hands
 *     the rail `{asked: true}` only for an asked batch;
 *   - a served head is taken only when asked, judged only by "the type's app is on", and goes through the store's own
 *     causal merge (it cannot replace a newer held row); in a live fan or an unasked batch it is refused.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, verifySpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog } from '../../src/eventLog.js';
import { makeItemsRail, makeItemsEmitter, makeItemsPeerHandler, routeItemsMirror, ITEMS_BROADCAST, ITEMS_CATCHUP_SUBTYPES } from '../../src/v2/itemsRail.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';
import { noteKeptPolicyChanges } from '../../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';
import { allManifests } from '../../src/v2/manifestSources.js';
import { NOT_TAKEN } from '../../src/core/handlers/peerRouter.js';

const CIRCLE = 'circle:served';
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const ON = {};
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const APP_OFF = { features: { tasks: false } };
const change = (version, policy, hash, items = []) => ({ kind: POLICY_UPDATE_KIND, author: 'admin', hash, payload: { policy, version, contentUpTo: { items, chat: [] } } });

async function device(ref, roster) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  roster.push({ webid: ref, circleAddress: cid.pubKey, role: 'member' });
  const registry = createRegistry(); registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const log = new EventLog({ initial: [], muted: [] });
  const rail = makeItemsRail({
    eventLog: log, circleIdentityFor: async () => cid, myRef: ref,
    callSkill: async () => ({ members: roster.map((m) => ({ ...m })) }),
    storeFor: (c) => stores.getStore(c),
    verifyBinding: async ({ author, ref: r }) => roster.some((m) => m.circleAddress === author && m.webid === r),
    judge: { manifests: () => allManifests() },
  });
  const wire = [];
  const store = stores.getStore(CIRCLE);
  wireStoreMirror(store, routeItemsMirror({ circleId: CIRCLE, emitter: makeItemsEmitter({ rail, fan: (c, st) => wire.push(st) }) }));
  return { ref, cid, log, rail, store, stores, wire };
}

/** A server holding a row with no statement left on its lane (aged out): its catch-up synthesizes a head for it. */
async function serverWithAgedRow(roster, text = 'an old row') {
  const s = await device('webid:server', roster);
  await s.store.put({ id: 'old-1', type: 'task', text }, { sync: false });
  return s;
}

describe('the serving device marks a synthesized head as served, inside the signed body', () => {
  it('a head for a row the lane no longer covers carries served:true and verifies; an author\'s own statement does not', async () => {
    const roster = [];
    const s = await serverWithAgedRow(roster);
    await addTasks(s.store, [{ text: 'fresh' }], { actor: 'webid:server' });
    await settle();
    const all = await s.rail.catchUpStatements(CIRCLE);
    const synth = all.find((st) => st.body.subject === 'old-1');
    expect(synth?.body?.payload?.served, 'marked inside the body').toBe(true);
    expect(verifySpine(synth, { expectedCircleId: CIRCLE }).ok, 'the mark is under the signature').toBe(true);
    const own = all.filter((st) => st.body.subject !== 'old-1');
    expect(own.length).toBeGreaterThan(0);
    for (const st of own) expect(st.body.payload?.served).toBeUndefined();
  });
});

describe('a served head on arrival', () => {
  async function pair() {
    const roster = [];
    const s = await serverWithAgedRow(roster);
    const r = await device('webid:asker', roster);
    const synth = (await s.rail.catchUpStatements(CIRCLE)).find((st) => st.body.subject === 'old-1');
    return { s, r, synth };
  }

  it('in an unasked batch: refused, not on the log, not applied', async () => {
    const { r, synth } = await pair();
    noteKeptPolicyChanges(r.log, CIRCLE, [change(1, ON, 'p1')]);
    const res = await r.rail.ingest(CIRCLE, synth);
    expect(res?.ok).toBe(false);
    expect(r.rail.storedStatements(CIRCLE).some((st) => st.body.hash === synth.body.hash)).toBe(false);
    expect(await r.store.get('old-1')).toBeFalsy();
  });

  it('in the live fan: refused at the door, and never passed on', async () => {
    const { r, synth } = await pair();
    noteKeptPolicyChanges(r.log, CIRCLE, [change(1, ON, 'p1')]);
    const door = makeItemsPeerHandler({ rail: r.rail });
    expect(await door(null, { subtype: ITEMS_BROADCAST, circleId: CIRCLE, event: synth })).toBe(NOT_TAKEN);
    expect(await r.store.get('old-1')).toBeFalsy();
    let passed = 0;
    const carrier = makeItemsPeerHandler({ rail: r.rail, holds: () => false, onPassed: () => { passed += 1; } });
    expect(await carrier(null, { subtype: ITEMS_BROADCAST, circleId: CIRCLE, event: synth })).toBe(NOT_TAKEN);
    expect(passed, 'a device that does not hold the lane does not carry it on either').toBe(0);
  });

  it('asked, with adding switched off: taken (judged only by the type\'s app being on), and kept through a restart\'s re-apply', async () => {
    const { r, synth } = await pair();
    noteKeptPolicyChanges(r.log, CIRCLE, [change(1, ON, 'p1'), change(2, ADD_OFF, 'p2')]);
    const res = await r.rail.ingest(CIRCLE, synth, { asked: true });
    expect(res?.ok).toBe(true);
    expect((await r.store.get('old-1'))?.text, 'a joiner gets the existing row').toBe('an old row');
    await r.store.delete('old-1', { sync: false });
    await r.rail.rebuildHead(CIRCLE);
    expect((await r.store.get('old-1'))?.text, 'the re-apply from the log takes it again').toBe('an old row');
  });

  it('asked, with the type\'s app switched off: on the log, not applied', async () => {
    const { r, synth } = await pair();
    noteKeptPolicyChanges(r.log, CIRCLE, [change(1, ON, 'p1'), change(2, APP_OFF, 'p2')]);
    await r.rail.ingest(CIRCLE, synth, { asked: true });
    expect(await r.store.get('old-1')).toBeFalsy();
  });

  it('asked, for a row held newer here: the store\'s causal merge keeps the newer row', async () => {
    const roster = [];
    const r = await device('webid:asker', roster);
    noteKeptPolicyChanges(r.log, CIRCLE, [change(1, ON, 'p1')]);
    const [mine] = await addTasks(r.store, [{ text: 'first' }], { actor: 'webid:asker' });
    const older = await r.store.get(mine.id);
    await r.store.put({ ...older, text: 'newer here' }, { by: 'webid:asker' });
    // a server that holds only the older state of the row, with no statement of it left on its lane
    const s = await device('webid:server', roster);
    await s.store.put(older, { sync: false, origin: true });
    const synth = (await s.rail.catchUpStatements(CIRCLE)).find((st) => st.body.subject === mine.id);
    expect(synth?.body?.payload?.served).toBe(true);
    await r.rail.ingest(CIRCLE, synth, { asked: true });
    expect((await r.store.get(mine.id))?.text).toBe('newer here');
  });
});

describe('the catch-up hands the rail {asked: true} only for a batch it asked for', () => {
  function replay({ askedWindowMs } = {}) {
    const calls = [];
    const rail = {
      storedStatements: () => [],
      ingest: async (circleId, s, ctx) => { calls.push({ id: s.id, asked: ctx?.asked === true }); return { ok: true }; },
    };
    let clock = 1000;
    const cu = makeFrontierReplay({
      rail, sendToPeer: async () => {}, subtypes: ITEMS_CATCHUP_SUBTYPES,
      ...(askedWindowMs ? { askedWindowMs } : {}), now: () => clock,
    });
    return { cu, calls, tick: (ms) => { clock += ms; } };
  }
  const batch = (id, extra = {}) => ({ subtype: ITEMS_CATCHUP_SUBTYPES.batch, circleId: CIRCLE, statements: [{ id }], seq: 0, done: true, more: false, ...extra });

  it('asked of this peer for this circle: asked; another peer, or another circle: not', async () => {
    const { cu, calls } = replay();
    await cu.requestFrom('peer:a', CIRCLE);
    await cu.onBatch('peer:b', batch('from-b', { done: false }));
    await cu.onBatch('peer:a', { ...batch('other-circle'), circleId: 'circle:other' });
    await cu.onBatch('peer:a', batch('from-a'));
    expect(calls).toEqual([
      { id: 'from-b', asked: false },
      { id: 'other-circle', asked: false },
      { id: 'from-a', asked: true },
    ]);
  });

  it('until the batch: a second batch after the last one is not asked', async () => {
    const { cu, calls } = replay();
    await cu.requestFrom('peer:a', CIRCLE);
    await cu.onBatch('peer:a', batch('one', { done: false }));
    await cu.onBatch('peer:a', batch('two'));
    await cu.onBatch('peer:a', batch('late'));
    expect(calls.map((c) => c.asked)).toEqual([true, true, false]);
  });

  it('until a timeout: an answer after the window is not asked', async () => {
    const { cu, calls, tick } = replay({ askedWindowMs: 5000 });
    await cu.requestFrom('peer:a', CIRCLE);
    tick(6000);
    await cu.onBatch('peer:a', batch('too-late'));
    expect(calls).toEqual([{ id: 'too-late', asked: false }]);
  });
});
