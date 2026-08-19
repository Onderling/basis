/**
 * End-to-end: two notify-envelope substrates over a shared fake
 * bus. Verifies the three acceptance criteria from plan §52.4:
 *
 *   (a) Centralised circle online → envelope-only on the wire;
 *       recipient fetches lazily.
 *   (b) Centralised circle offline → full-payload fan-out;
 *       pending queue holds; drain on reconnect emits envelope-only.
 *   (c) No-pod circle → full-payload fan-out always; receiver pseudo-pod
 *       holds the canonical copy.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting } from '@onderling/pod-routing';
import { createNotifyEnvelope } from '../src/NotifyEnvelope.js';

/** A minimal in-memory bus that mirrors Transport.publishEnvelope. */
function makeBus() {
  const inboxes = new Map();
  return {
    bind(address, cb) { inboxes.set(address, cb); },
    async publish({ recipients, ...wire }) {
      for (const to of recipients ?? []) {
        const cb = inboxes.get(to);
        if (cb) await cb(wire);
      }
    },
  };
}

/** A transport adaptor over the bus, tied to one local address. */
function transportFor(bus, selfAddress) {
  let cb = null;
  bus.bind(selfAddress, async (wire) => { if (cb) await cb(wire, { _from: 'peer' }); });
  return {
    async publishEnvelope(env) {
      // Strip recipients before reshipping — that's how Transport behaves.
      const { recipients, ...wire } = env;
      await bus.publish({ recipients, ...wire });
    },
    subscribeEnvelopes(callback) { cb = callback; return () => { cb = null; }; },
  };
}

function makePeer({ bus, address, deviceId, anchorPodUri = null, uploadFn }) {
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
  const podRouting = createPodRouting({ pseudoPod, deviceId, anchorPodUri });
  const transport  = transportFor(bus, address);
  const ne = createNotifyEnvelope({ transport, pseudoPod, podRouting, uploadFn });
  ne.start();
  return { ne, pseudoPod, podRouting, transport, address };
}

describe('Integration — centralised circle, online (envelope-only)', () => {
  it('Anne writes envelope-only; Bob receives envelope without payload', async () => {
    const bus = makeBus();
    const anne = makePeer({ bus, address: 'anne', deviceId: 'anne', anchorPodUri: 'https://anne.pod' });
    const bob  = makePeer({ bus, address: 'bob',  deviceId: 'bob',  anchorPodUri: 'https://anne.pod' });

    const got = [];
    bob.ne.subscribe({ kind: 'task', callback: (env) => got.push(env) });

    await anne.ne.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      etag:       '"v1"',
      payload:    { text: 'paint' },   // not used — envelope-only
      recipients: ['bob'],
      fromActor:  'agent://anne',
    });

    expect(got).toHaveLength(1);
    expect(got[0].ref).toBe('https://anne.pod/sharing/tasks/abc.ttl');
    expect(got[0].payload).toBeUndefined();
    // Recipient pseudo-pod stays empty (would fetch lazily via pod-client).
    expect(await bob.pseudoPod.read('https://anne.pod/sharing/tasks/abc.ttl')).toBe(null);

    anne.ne.stop(); bob.ne.stop();
  });
});

describe('Integration — centralised circle, offline (full-payload + queue)', () => {
  it('Anne offline → full-payload fan-out; queue holds; drain re-emits envelope', async () => {
    const bus = makeBus();
    const uploaded = [];
    const anne = makePeer({
      bus, address: 'anne', deviceId: 'anne',
      anchorPodUri: 'https://anne.pod',
      uploadFn: async (entry) => { uploaded.push(entry.uri); },
    });
    const bob = makePeer({ bus, address: 'bob', deviceId: 'bob' });

    // Pod's offline.
    anne.podRouting.markPodUnreachable();

    const got = [];
    bob.ne.subscribe({ kind: 'task', callback: (env) => got.push(env) });

    await anne.ne.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/abc.ttl',
      etag:       '"v-hash"',
      payload:    { text: 'paint' },
      recipients: ['bob'],
      fromActor:  'agent://anne',
    });

    // Bob got the full-payload envelope.
    expect(got).toHaveLength(1);
    expect(got[0].payload).toEqual({ text: 'paint' });
    expect((await bob.pseudoPod.read('https://anne.pod/sharing/tasks/abc.ttl'))?.bytes)
      .toEqual({ text: 'paint' });

    // Anne's pending queue holds the entry.
    expect(await anne.ne.pendingCount()).toBe(1);

    // Reconnect: mark reachable + drain.
    anne.podRouting.markPodReachable();
    const drain = await anne.ne.drainQueue();
    expect(drain.drained).toBe(1);
    expect(uploaded).toEqual(['https://anne.pod/sharing/tasks/abc.ttl']);

    // Bob receives the second, envelope-only message.
    expect(got).toHaveLength(2);
    expect(got[1].ref).toBe('https://anne.pod/sharing/tasks/abc.ttl');
    expect(got[1].payload).toBeUndefined();

    anne.ne.stop(); bob.ne.stop();
  });
});

describe('Integration — no-pod circle (full-payload always)', () => {
  it('Anne (no pod) writes full-payload; Bob auto-writeFromPeer; queue stays empty', async () => {
    const bus = makeBus();
    const anne = makePeer({ bus, address: 'anne', deviceId: 'anne' });
    const bob  = makePeer({ bus, address: 'bob',  deviceId: 'bob'  });

    const got = [];
    bob.ne.subscribe({ kind: 'offer', callback: (env) => got.push(env) });

    await anne.ne.publish({
      type:       'offer',
      ref:        'pseudo-pod://anne/sharing/offers/abc',
      etag:       '"hash-1"',
      payload:    { body: 'ladder lend' },
      recipients: ['bob'],
      fromActor:  'pseudo-pod://anne/agent',
      circleId:     'household-xyz',
    });

    expect(got).toHaveLength(1);
    expect(got[0].payload).toEqual({ body: 'ladder lend' });
    expect((await bob.pseudoPod.read('pseudo-pod://anne/sharing/offers/abc'))?.bytes)
      .toEqual({ body: 'ladder lend' });
    expect(await anne.ne.pendingCount()).toBe(0);

    anne.ne.stop(); bob.ne.stop();
  });
});

describe('Integration — queue survives substrate restart', () => {
  it('a fresh notify-envelope on the same backend sees prior pending entries', async () => {
    const bus = makeBus();
    const sharedBackend = createMemoryBackend();
    const pseudoPod = createPseudoPod({
      backend:  sharedBackend, mode: 'standalone', deviceId: 'anne',
    });
    const podRouting = createPodRouting({
      pseudoPod, deviceId: 'anne', anchorPodUri: 'https://anne.pod',
    });
    podRouting.markPodUnreachable();

    const transport = transportFor(bus, 'anne');
    const ne1 = createNotifyEnvelope({ transport, pseudoPod, podRouting });
    await ne1.publish({
      type:       'task',
      ref:        'https://anne.pod/sharing/tasks/x.ttl',
      etag:       'e',
      payload:    { text: 'paint' },
      recipients: ['bob'],
      fromActor:  'agent://anne',
    });
    expect(await ne1.pendingCount()).toBe(1);

    // "Restart" — new substrate over the same pseudo-pod / backend.
    const ne2 = createNotifyEnvelope({ transport, pseudoPod, podRouting });
    expect(await ne2.pendingCount()).toBe(1);
    const entries = await ne2.listPending();
    expect(entries[0].uri).toBe('https://anne.pod/sharing/tasks/x.ttl');
  });
});
