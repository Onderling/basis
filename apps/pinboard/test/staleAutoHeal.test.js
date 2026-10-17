/**
 * A1 (substrate-adoption) — stale-peer auto-heal in substrateMirror.
 *
 * When pseudoPod emits `'stale-peer'` (a peer wrote with an older
 * `_v` than ours), `wireSubstrateMirror` should publish the fresher
 * local copy back to that one peer via notifyEnvelope.publish.
 * Silent (no UI affordance) — lean from the open-questions
 * doc.
 */
import { describe, it, expect } from 'vitest';
import { wireSubstrateMirror } from '../src/substrateMirror.js';

function makeMockPseudoPod() {
  const handlers = new Map();
  return {
    on(event, cb) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(cb);
      return () => set.delete(cb);
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const cb of [...set]) cb(payload);
    },
    listenerCount(event) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

function makeMockNotifyEnvelope() {
  const subs = new Map();   // kind → Set<cb>
  const published = [];
  return {
    subscribe({ kind, callback }) {
      let set = subs.get(kind);
      if (!set) { set = new Set(); subs.set(kind, set); }
      set.add(callback);
      return () => set.delete(callback);
    },
    publish(args) {
      published.push(args);
      return Promise.resolve({ mode: 'full-payload', queued: false, decision: {} });
    },
    get published() { return published; },
  };
}

const mockItemStore = {
  listOpen: async () => [],
  addItems: async () => {},
};

const GROUP = 'oosterpoort';
const SELF  = 'pubkey:self-abc';
const PEER  = 'pubkey:peer-xyz';

function localUri() {
  return `pseudo-pod://device-self/pinboard/${GROUP}/requests/req-001`;
}

describe('A1 — stale-peer auto-heal', () => {
  it('subscribes to pseudoPod stale-peer on wire', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    expect(pseudoPod.listenerCount('stale-peer')).toBe(1);
  });

  it('republishes the local fresher copy back to the stale peer', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    const uri = localUri();
    const localBytes = { requestId: 'req-001', text: 'I have the newer version' };
    pseudoPod.emit('stale-peer', {
      uri,
      fromActor:  PEER,
      peerV:      1,
      localV:     2,
      localBytes,
      localEtag:  '"e2"',
    });
    // publish is async, but the handler kicks it off synchronously; flush microtasks
    await Promise.resolve();
    expect(notifyEnvelope.published).toHaveLength(1);
    const p = notifyEnvelope.published[0];
    expect(p.type).toBe('request');
    expect(p.ref).toBe(uri);
    expect(p.payload).toEqual(localBytes);
    expect(p.etag).toBe('"e2"');
    expect(p._v).toBe(2);
    expect(p.recipients).toEqual([PEER]);
    expect(p.fromActor).toBe(SELF);
  });

  it('ignores stale-peer events from other groups (URI prefix mismatch)', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    pseudoPod.emit('stale-peer', {
      uri:        'pseudo-pod://device-self/pinboard/some-other-group/requests/req-001',
      fromActor:  PEER,
      peerV:      1,
      localV:     2,
      localBytes: { requestId: 'req-001' },
      localEtag:  '"e2"',
    });
    await Promise.resolve();
    expect(notifyEnvelope.published).toHaveLength(0);
  });

  it('ignores events with no fromActor', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    pseudoPod.emit('stale-peer', {
      uri:        localUri(),
      // no fromActor
      peerV:      1,
      localV:     2,
      localBytes: { requestId: 'req-001' },
    });
    await Promise.resolve();
    expect(notifyEnvelope.published).toHaveLength(0);
  });

  it('ignores events with null/undefined localBytes', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    pseudoPod.emit('stale-peer', {
      uri:        localUri(),
      fromActor:  PEER,
      peerV:      1,
      localV:     2,
      localBytes: null,
    });
    await Promise.resolve();
    expect(notifyEnvelope.published).toHaveLength(0);
  });

  it('does not republish to self', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    pseudoPod.emit('stale-peer', {
      uri:        localUri(),
      fromActor:  SELF,
      peerV:      1,
      localV:     2,
      localBytes: { requestId: 'req-001' },
    });
    await Promise.resolve();
    expect(notifyEnvelope.published).toHaveLength(0);
  });

  it('swallows publish failures (best-effort heal)', async () => {
    const pseudoPod = makeMockPseudoPod();
    const failingEnvelope = {
      subscribe() { return () => {}; },
      publish() { return Promise.reject(new Error('network down')); },
    };
    await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope: failingEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    // Should NOT throw synchronously when the handler fires.
    expect(() => pseudoPod.emit('stale-peer', {
      uri:        localUri(),
      fromActor:  PEER,
      peerV:      1,
      localV:     2,
      localBytes: { requestId: 'req-001' },
    })).not.toThrow();
    await Promise.resolve();
  });

  it('stop() unsubscribes from stale-peer', async () => {
    const pseudoPod = makeMockPseudoPod();
    const notifyEnvelope = makeMockNotifyEnvelope();
    const mirror = await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    expect(pseudoPod.listenerCount('stale-peer')).toBe(1);
    await mirror.stop();
    expect(pseudoPod.listenerCount('stale-peer')).toBe(0);
  });

  it('tolerates a pseudoPod with no on() method (back-compat)', async () => {
    const noEventsPod = {};  // no on, no off
    const notifyEnvelope = makeMockNotifyEnvelope();
    // Should NOT throw during wireSubstrateMirror or stop.
    const mirror = await wireSubstrateMirror({
      itemStore: mockItemStore,
      notifyEnvelope,
      pseudoPod:  noEventsPod,
      group:      GROUP,
      selfPubKey: SELF,
    });
    await mirror.stop();
  });
});
