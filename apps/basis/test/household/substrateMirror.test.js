import { describe, it, expect, vi } from 'vitest';
import { InMemoryStore } from '../../src/household/InMemoryStore.js';
import { wireHouseholdSubstrateMirror } from '../../src/household/substrateMirror.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness() {
  const subs = {};
  const notifyEnvelope = {
    subscribe: ({ kind, callback }) => { subs[kind] = callback; return () => {}; },
    publish:   vi.fn(async () => {}),
  };
  const pseudoPod = {
    deviceId: 'devA',
    write:    async () => ({ etag: 'e1', _v: 1 }),
    on:       () => null,
  };
  return { subs, notifyEnvelope, pseudoPod };
}

describe('wireHouseholdSubstrateMirror', () => {
  it('publishItem fans out to peers', async () => {
    const { notifyEnvelope, pseudoPod } = makeHarness();
    const store = new InMemoryStore();
    const itemStore = store.substrate;
    const mirror = await wireHouseholdSubstrateMirror({
      itemStore, notifyEnvelope, pseudoPod,
      circleId: 'c1', peers: [{ pubKey: 'B' }], selfPubKey: 'A',
    });

    await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    const [raw] = await itemStore.listOpen();

    await mirror.publishItem(raw);

    expect(notifyEnvelope.publish).toHaveBeenCalledTimes(1);
    const arg = notifyEnvelope.publish.mock.calls[0][0];
    expect(arg.type).toBe('household-item');
    expect(arg.recipients).toEqual(['B']);
    expect(arg.ref).toContain('/household/circles/c1/items/');
  });

  it('mirror-on-receive adds an inbound item', async () => {
    const { subs, notifyEnvelope, pseudoPod } = makeHarness();
    const store = new InMemoryStore();
    const itemStore = store.substrate;
    await wireHouseholdSubstrateMirror({
      itemStore, notifyEnvelope, pseudoPod,
      circleId: 'c1', peers: [{ pubKey: 'B' }], selfPubKey: 'A',
    });

    subs['household-item']({
      ref: 'pseudo-pod://devB/household/circles/c1/items/REMOTE1',
      fromActor: 'B',
      payload: { id: 'REMOTE1', type: 'task', text: 'Eggs', addedBy: 'webid:bob' },
    });
    await tick();

    const open = await itemStore.listOpen();
    const got = open.find((i) => i.source?.syncedFromId === 'REMOTE1');
    expect(got).toBeTruthy();
    expect(got.text).toBe('Eggs');
  });

  it('mirror-on-receive applies a completion update', async () => {
    const { subs, notifyEnvelope, pseudoPod } = makeHarness();
    const store = new InMemoryStore();
    const itemStore = store.substrate;
    await wireHouseholdSubstrateMirror({
      itemStore, notifyEnvelope, pseudoPod,
      circleId: 'c1', peers: [{ pubKey: 'B' }], selfPubKey: 'A',
    });

    subs['household-item']({
      ref: 'pseudo-pod://devB/household/circles/c1/items/REMOTE1',
      fromActor: 'B',
      payload: { id: 'REMOTE1', type: 'task', text: 'Eggs', addedBy: 'webid:bob' },
    });
    await tick();

    subs['household-item']({
      ref: 'pseudo-pod://devB/household/circles/c1/items/REMOTE1',
      fromActor: 'B',
      payload: { id: 'REMOTE1', type: 'task', text: 'Eggs', addedBy: 'webid:bob', completedAt: Date.now() },
    });
    await tick();

    const closed = await itemStore.listClosed();
    const done = closed.find((i) => i.source?.syncedFromId === 'REMOTE1');
    expect(done).toBeTruthy();
    expect(done.completedAt).toBeTruthy();
    const stillOpen = (await itemStore.listOpen()).find((i) => i.source?.syncedFromId === 'REMOTE1');
    expect(stillOpen).toBeFalsy();
  });

  it('mirror-on-receive hard-deletes on a removed envelope', async () => {
    const { subs, notifyEnvelope, pseudoPod } = makeHarness();
    const store = new InMemoryStore();
    const itemStore = store.substrate;
    await wireHouseholdSubstrateMirror({
      itemStore, notifyEnvelope, pseudoPod,
      circleId: 'c1', peers: [{ pubKey: 'B' }], selfPubKey: 'A',
    });

    subs['household-item']({
      ref: 'pseudo-pod://devB/household/circles/c1/items/REMOTE1',
      fromActor: 'B',
      payload: { id: 'REMOTE1', type: 'task', text: 'Eggs', addedBy: 'webid:bob' },
    });
    await tick();

    subs['household-item-removed']({
      ref: 'pseudo-pod://devB/household/circles/c1/items/REMOTE1',
      fromActor: 'B',
      payload: { originalId: 'REMOTE1' },
    });
    await tick();

    const open = await itemStore.listOpen();
    const closed = await itemStore.listClosed();
    const present = [...open, ...closed].find((i) => i.source?.syncedFromId === 'REMOTE1');
    expect(present).toBeFalsy();
  });

  it('ignores a household-item envelope whose ref omits the uriPrefix', async () => {
    const { subs, notifyEnvelope, pseudoPod } = makeHarness();
    const store = new InMemoryStore();
    const itemStore = store.substrate;
    await wireHouseholdSubstrateMirror({
      itemStore, notifyEnvelope, pseudoPod,
      circleId: 'c1', peers: [{ pubKey: 'B' }], selfPubKey: 'A',
    });

    subs['household-item']({
      ref: 'pseudo-pod://devB/household/circles/OTHER/items/REMOTE9',
      fromActor: 'B',
      payload: { id: 'REMOTE9', type: 'task', text: 'Nope', addedBy: 'webid:bob' },
    });
    await tick();

    const open = await itemStore.listOpen();
    expect(open.find((i) => i.source?.syncedFromId === 'REMOTE9')).toBeFalsy();
  });
});
