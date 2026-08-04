/**
 * THREE devices on one task-log bus — the fan-out fix, proven at the scale where it actually bites.
 *
 * A two-device test can pass while the third device silently never receives anything (the exact shape
 * of the bug this cutover fixes). This harness wires three task stores to a simulated circle bus:
 * every local transition fans to the OTHER two via `onLogEntry` → `applyLogEntry`, and a PARTITIONED
 * device holds its inbound entries (as the relay's hold-forward would) and flushes them in order on
 * reconnect. Mirrors `apps/basis/test/v2/helpers/threeDeviceGovernance.js` — the same model, one layer
 * down, over the real store primitives (no new production wiring; those seams await the batch-2
 * decision on where the boot hook lives).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { createTaskStore } from '../src/createTaskStore.js';

const REFS = ['alice', 'bob', 'cato'];

/** Wire three stores onto one bus. Returns handles + partition/reconnect + a `settle` barrier. */
function threeDevices() {
  const devices = {};
  const held = {};          // ref → [entry] while partitioned
  const pending = [];        // in-flight ingest promises — awaited by settle()

  for (const ref of REFS) {
    devices[ref] = {
      ref,
      online: true,
      store: createTaskStore(new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' })),
    };
    held[ref] = [];
  }

  const deliver = (d, entry) => { pending.push(Promise.resolve(d.store.applyLogEntry(entry))); };

  // Each device fans every entry it appends (local OR ingested) to the other two — deduped at the
  // receiver, so the re-fan of an ingested entry (device B relays A's create to C) can't loop.
  for (const ref of REFS) {
    devices[ref].store.onLogEntry((entry) => {
      for (const other of REFS) {
        if (other === ref) continue;
        if (devices[other].online) deliver(devices[other], entry);
        else held[other].push(entry);
      }
    });
  }

  return {
    devices,
    partition: (ref) => { devices[ref].online = false; },
    reconnect: (ref) => {
      devices[ref].online = true;
      const queue = held[ref].splice(0, held[ref].length);
      for (const entry of queue) deliver(devices[ref], entry);
    },
    /** Drain the fan until quiescent — re-fans can enqueue more work, so loop until none is added. */
    settle: async () => {
      while (pending.length) {
        const batch = pending.splice(0, pending.length);
        await Promise.all(batch);
      }
    },
  };
}

/** The head as {id, text, assignee, completed}, sorted — what every replica must agree on. */
async function headOf(store) {
  const open = await store.listOpen();
  const closed = await store.listClosed();
  return [...open, ...closed]
    .map((i) => ({ id: i.id, text: i.text, assignee: i.assignee ?? null, completed: !!i.completedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('task-log — three devices converge', () => {
  let h;
  beforeEach(() => { h = threeDevices(); });

  it('a task created on one device reaches BOTH others (not just the first)', async () => {
    const [task] = await h.devices.alice.store.addItems([{ text: 'buy milk' }], { actor: 'webid:alice' });
    await h.settle();

    expect((await h.devices.bob.store.getById(task.id))?.text).toBe('buy milk');
    expect((await h.devices.cato.store.getById(task.id))?.text).toBe('buy milk');   // the third device — the bug
  });

  it('a claim on device B is seen by A and C, and all three heads converge', async () => {
    const [task] = await h.devices.alice.store.addItems([{ text: 'take out bins' }], { actor: 'webid:alice' });
    await h.settle();
    await h.devices.bob.store.claim(task.id, { actor: 'webid:bob' });
    await h.settle();

    for (const ref of REFS) {
      expect((await h.devices[ref].store.getById(task.id))?.assignee).toBe('webid:bob');
    }
    expect(await headOf(h.devices.alice.store)).toEqual(await headOf(h.devices.cato.store));
    expect(await headOf(h.devices.bob.store)).toEqual(await headOf(h.devices.cato.store));
  });

  it('a PARTITIONED device catches up on reconnect — held entries flush in order', async () => {
    h.partition('cato');

    const [t1] = await h.devices.alice.store.addItems([{ text: 'water plants' }], { actor: 'webid:alice' });
    await h.settle();
    await h.devices.bob.store.claim(t1.id, { actor: 'webid:bob' });
    await h.settle();
    // Cato saw none of it while away.
    expect(await h.devices.cato.store.getById(t1.id)).toBeNull();

    h.reconnect('cato');
    await h.settle();

    const onCato = await h.devices.cato.store.getById(t1.id);
    expect(onCato?.text).toBe('water plants');
    expect(onCato?.assignee).toBe('webid:bob');           // create AND claim both landed, in order
    expect(await headOf(h.devices.cato.store)).toEqual(await headOf(h.devices.alice.store));
  });

  it('concurrent creates on different devices all converge everywhere (no entry lost between peers)', async () => {
    await h.devices.alice.store.addItems([{ text: 'from alice' }], { actor: 'webid:alice' });
    await h.devices.bob.store.addItems([{ text: 'from bob' }], { actor: 'webid:bob' });
    await h.devices.cato.store.addItems([{ text: 'from cato' }], { actor: 'webid:cato' });
    await h.settle();

    const heads = await Promise.all(REFS.map((r) => headOf(h.devices[r].store)));
    expect(heads[0]).toEqual(heads[1]);
    expect(heads[1]).toEqual(heads[2]);
    expect(heads[0].map((t) => t.text).sort()).toEqual(['from alice', 'from bob', 'from cato']);
  });
});
