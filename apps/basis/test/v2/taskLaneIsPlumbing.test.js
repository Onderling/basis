import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { entryKind, LANE } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeTaskRail, makeTaskEmitter, makeTaskPeerHandler, routeTaskMirror, TASK_BROADCAST } from '../../src/v2/taskRail.js';
import { TASK_LANE } from '../../src/v2/taskManifest.js';
import { projectEntries } from '../../src/v2/circleStream.js';
import { isSilentEntry } from '../../src/eventLog.js';

// A task statement on the device log is PLUMBING: the signed carrier of a store head, not a line of the
// conversation. The line a circle may want to show ("B added a task") is a separate, derived rendering that
// the circle's rules decide on. Walked on 2026-09-14 through three real shells: once a task existed, every
// statement that landed — live, and again on each catch-up round — was painted as an empty bubble with the
// entrust and report chips on it. The cause was the lane's entries sharing their kind name with the
// human-facing `task` kind in the kinds table, which is what the conversation projection reads.

const CIRCLE = 'circle:plumbing';

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

async function device(ref, rosterAll, wire) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const registry = createRegistry();
  registerCanonicalTypes(registry);
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
  const emitter = makeTaskEmitter({ rail, fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }) });
  const store = stores.getStore(CIRCLE);
  wireStoreMirror(store, routeTaskMirror({ circleId: CIRCLE, emitter }));
  const receiver = makeTaskPeerHandler({ rail });
  return { ref, cid, eventLog, store, rail, emitter, receiver };
}

async function pump(wire, devices) {
  while (wire.length) {
    const w = wire.shift();
    for (const d of devices) {
      if (d.ref === w.from) continue;
      await d.receiver(null, { subtype: TASK_BROADCAST, circleId: w.circleId, event: w.statement });
    }
  }
}

const laneEntries = (log) => log.entries.filter((e) => e.type === TASK_LANE);
const conversationRows = (log) => projectEntries({ events: log.query(), circles: [], lane: 'human' });

describe('the task lane is plumbing, not conversation', () => {
  it('the lane\'s entry kind is registered as system lane, distinct from the human-facing task kind', () => {
    expect(entryKind(TASK_LANE).lane).toBe(LANE.SYSTEM);
    expect(TASK_LANE).not.toBe('task');
  });

  it('a task added on one device materialises on the other and paints NO conversation row there', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    const [task] = await addTasks(ada.store, [{ text: 'brood halen' }], { actor: 'webid:ada' });
    await settle();
    await pump(wire, [ada, bo]);

    expect((await bo.store.get(task.id))?.text).toBe('brood halen');    // the head arrived (unchanged)
    expect(laneEntries(bo.eventLog)).toHaveLength(1);                    // recorded, signed, on bo's log
    for (const e of laneEntries(bo.eventLog)) expect(isSilentEntry(e), 'a lane statement is silent').toBe(true);
    const rows = conversationRows(bo.eventLog).filter((r) => r.event?.type === TASK_LANE);
    expect(rows, 'no statement of the task lane is a conversation row').toHaveLength(0);
  });

  it('a catch-up served twice lands once: a synthesized snapshot for the same head is the same statement', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const wire = [];
    const ada = await device('webid:ada', rosterAll, wire);
    const bo  = await device('webid:bo',  rosterAll, wire);

    // A head ada holds WITHOUT a stored statement (written directly, as the seed and the legacy paths do):
    // the serve has to synthesize a snapshot for it, on every round.
    await ada.store.put({ id: 'task-direct', type: 'task', text: 'fix the gate', createdBy: 'webid:ada' }, { by: 'webid:ada', sync: false });

    for (const s of await ada.rail.catchUpStatements(CIRCLE)) await bo.rail.ingest(CIRCLE, s);
    const afterOne = laneEntries(bo.eventLog).length;
    expect(afterOne).toBe(1);
    for (const s of await ada.rail.catchUpStatements(CIRCLE)) await bo.rail.ingest(CIRCLE, s);
    expect(laneEntries(bo.eventLog).length, 'a second round adds nothing for an unchanged head').toBe(afterOne);

    // …and a CHANGED head is a new statement, as it should be.
    await ada.store.put({ id: 'task-direct', type: 'task', text: 'fix the gate, properly', createdBy: 'webid:ada' }, { by: 'webid:ada', sync: false });
    for (const s of await ada.rail.catchUpStatements(CIRCLE)) await bo.rail.ingest(CIRCLE, s);
    expect(laneEntries(bo.eventLog).length).toBe(afterOne + 1);
    expect((await bo.store.get('task-direct'))?.text).toBe('fix the gate, properly');
  });
});
