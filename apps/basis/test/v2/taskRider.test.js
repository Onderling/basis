import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  createCircleStores, memoryDataSource, wireStoreMirror,
  addTasks, claim as claimTask, reassign as reassignTask,
} from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import {
  makeTaskRail, makeTaskEmitter, makeTaskPeerHandler, routeTaskMirror,
  TASK_BROADCAST, TASK_CATCHUP_SUBTYPES,
} from '../../src/v2/taskRail.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';

// The content re-root's acceptance (tasks first): a task write on one device rides the device log's task
// lane as a SIGNED full-item snapshot — fanned, verified at the receiver's rail, and causally merged into
// the receiver's store head with the writer's claim cluster intact. The legacy mirror stops carrying task
// items (the per-type valve); a forged statement never lands; the offline device converges via catch-up,
// including heads whose lane entries have aged out (served as signed snapshots).

const CIRCLE = 'circle:tasks';

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

const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

/** A member device: per-circle identity, device log, store (real CircleItemStore), rail, and the
 *  publish valve wired exactly as production wires it (tasks → lane, the rest → the legacy mirror). */
async function device(ref, rosterAll, wire) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  registry.registerType('shopping', { type: 'object', properties: { type: { const: 'shopping' }, text: { type: 'string' } }, required: ['type', 'text'] });
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const eventLog = fakeEventLog();
  const rail = makeTaskRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async () => ({}),
    storeFor: (circleId) => stores.getStore(circleId),
    verifyBinding: async ({ author, ref: r }) => rosterAll.some((m) => m.circleAddress === author && m.webid === r),
  });
  const emitter = makeTaskEmitter({
    rail,
    fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }),
  });
  const mirrorCalls = [];
  const legacyMirror = {
    publishItem:        (i)  => mirrorCalls.push(['item', i.type]),
    publishItemRemoved: (id) => mirrorCalls.push(['removed', id]),
  };
  const store = stores.getStore(CIRCLE);
  wireStoreMirror(store, routeTaskMirror({ circleId: CIRCLE, mirror: legacyMirror, emitter }));
  const receiver = makeTaskPeerHandler({ rail });
  return { ref, cid, eventLog, store, rail, emitter, receiver, mirrorCalls };
}

/** Deliver every queued statement to every OTHER device (the live fan). */
async function pump(wire, devices) {
  while (wire.length) {
    const w = wire.shift();
    for (const d of devices) {
      if (d.ref === w.from) continue;
      await d.receiver(null, { subtype: TASK_BROADCAST, circleId: w.circleId, event: w.statement });
    }
  }
}

describe('the task lane — snapshots on the device log, heads causally merged', () => {
  it('an added task fans as a SIGNED snapshot and materialises on the peer; the mirror no longer carries it', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    const [task] = await addTasks(ada.store, [{ text: 'fix the gate' }], { actor: 'webid:ada' });
    await settle();
    expect(ada.eventLog.entries).toHaveLength(1);                       // the lane entry, on the writer's own log
    expect(ada.mirrorCalls.find(([, t]) => t === 'task')).toBeUndefined();   // the valve: no mirror carry for tasks

    await pump(wire, [ada, bo]);
    const boHead = await bo.store.get(task.id);
    expect(boHead?.text).toBe('fix the gate');                          // materialised via the causal merge
    expect(bo.eventLog.entries).toHaveLength(1);                        // and recorded signed on bo's log
    expect(bo.eventLog.entries[0].payload.sig).toBeTruthy();

    // A NON-task item still rides the legacy mirror, not the lane.
    await ada.store.put({ id: 'shop-1', type: 'shopping', text: 'milk' }, { by: 'webid:ada' });
    await settle();
    expect(ada.mirrorCalls.find(([, t]) => t === 'shopping')).toBeTruthy();
    expect(ada.eventLog.entries).toHaveLength(1);                       // no lane entry for the shopping item
  });

  it('the writer-computed claim cluster travels: a claim lands with claimSeq + confirmation; a later authoritative reassign supersedes it', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    const [task] = await addTasks(ada.store, [{ text: 'water plants' }], { actor: 'webid:ada' });
    await settle(); await pump(wire, [ada, bo]);

    await claimTask(bo.store, task.id, { actor: 'webid:bo' });          // bo claims on THEIR device
    await settle(); await pump(wire, [ada, bo]);
    const onAda = await ada.store.get(task.id);
    expect(onAda.assignee).toBe('webid:bo');
    expect(onAda.claimSeq).toBe(1);
    expect(onAda.confirmedAssignee).toBe('webid:bo');                   // the confirmation crossed intact

    await reassignTask(ada.store, task.id, 'webid:ada', { actor: 'webid:ada' });   // authoritative supersede
    await settle(); await pump(wire, [ada, bo]);
    const onBo = await bo.store.get(task.id);
    expect(onBo.assignee).toBe('webid:ada');
    expect(onBo.claimSeq).toBe(2);                                      // the higher claim sequence won on bo too
  });

  it('CONCURRENT first claims converge to the same single winner on both devices (the claim fold)', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    const [task] = await addTasks(ada.store, [{ text: 'sweep stoop' }], { actor: 'webid:ada' });
    await settle(); await pump(wire, [ada, bo]);

    // Partitioned: both claim what each still sees as unclaimed. Two snapshots, both claimSeq 1.
    await claimTask(ada.store, task.id, { actor: 'webid:ada' });
    await claimTask(bo.store,  task.id, { actor: 'webid:bo'  });
    await settle(); await pump(wire, [ada, bo]);

    const a = await ada.store.get(task.id);
    const b = await bo.store.get(task.id);
    expect(a.assignee).toBe(b.assignee);                                // one winner, same on both
    expect(['webid:ada', 'webid:bo']).toContain(a.assignee);
    expect(a.claimSeq).toBe(b.claimSeq);
  });

  it('a FORGED statement (rogue key claiming a member ref) is refused — log and head untouched', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const rogue = await AgentIdentity.generate(new VaultMemory());

    await ada.receiver(null, {
      subtype: TASK_BROADCAST, circleId: CIRCLE,
      event: signSpine(rogue, {
        kind: 'snapshot', circleId: CIRCLE, subject: 't-x',
        payload: { item: { id: 't-x', type: 'task', text: 'planted' }, authorRef: 'webid:bo' }, parent: null,
      }),
    });
    expect(ada.eventLog.entries).toHaveLength(0);                       // unverifiable binding → refused
    expect(await ada.store.get('t-x')).toBeNull();                      // and the head never materialised
  });

  it('a REMOVE fans and deletes the peer head; an undeclared kind is refused loudly at append', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    const [task] = await addTasks(ada.store, [{ text: 'old chore' }], { actor: 'webid:ada' });
    await settle(); await pump(wire, [ada, bo]);
    expect(await bo.store.get(task.id)).toBeTruthy();

    await ada.store.delete(task.id);
    await settle(); await pump(wire, [ada, bo]);
    expect(await bo.store.get(task.id)).toBeNull();                     // the remove crossed the lane

    await expect(ada.rail.append(CIRCLE, { kind: 'sneaky', subject: 'x', payload: {} }))
      .rejects.toThrow(/not declared/);
  });

  it('catch-up serves stored entries AND signed live heads whose entries aged out; the offline device converges', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:cato', role: 'member' }];
    const wire = [];
    const ada  = await device('webid:ada',  rosterAll, wire);
    const cato = await device('webid:cato', rosterAll, wire);

    const [t1] = await addTasks(ada.store, [{ text: 'recent task' }], { actor: 'webid:ada' });
    await settle();
    // An OLD head whose lane entry has aged out: the row exists in ada's store with NO stored statement.
    await ada.store.put({ id: 'task-old', type: 'task', text: 'ancient but open' }, { by: 'webid:ada' });
    await settle();
    ada.eventLog.entries.splice(ada.eventLog.entries.findIndex((e) => e.payload?.body?.subject === 'task-old'), 1);
    wire.length = 0;                                                    // cato was OFFLINE for all of it

    const batches = [];
    const serve = makeFrontierReplay({
      rail: ada.rail, sendToPeer: (a, p) => batches.push(p),
      subtypes: TASK_CATCHUP_SUBTYPES, statementsFor: (cid) => ada.rail.catchUpStatements(cid),
    });
    const pull = makeFrontierReplay({
      rail: cato.rail, sendToPeer: () => {}, subtypes: TASK_CATCHUP_SUBTYPES,
    });
    await serve.onRequest('peer:cato', {
      subtype: TASK_CATCHUP_SUBTYPES.request, circleId: CIRCLE,
      frontier: pull.localFrontier(CIRCLE),                             // cato's (empty) head set
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].statements.length).toBe(2);                       // the stored entry + the synthesized head
    const res = await pull.onBatch('peer:ada', batches[0]);
    expect(res.landed).toBe(2);

    expect((await cato.store.get(t1.id))?.text).toBe('recent task');
    expect((await cato.store.get('task-old'))?.text).toBe('ancient but open');   // the aged-out head still arrived
  });
});
