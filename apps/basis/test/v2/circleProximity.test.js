/**
 * Lokale circle — the two rules that are privacy guarantees rather than UI (2026-07-27).
 *
 *   (b) discovery ≠ membership — being visible on the same Wi-Fi is not a relationship.
 *   (c) advertise only while the proximity view is open.
 *
 * (c) is the one that fails silently: broadcasting is invisible, so a device that keeps announcing itself
 * after you navigate away looks exactly like one that stopped. Every case below is a way that could happen
 * — a double open, a close that never came, an adapter that throws, a late callback after teardown.
 */
import { describe, it, expect, vi } from 'vitest';
import { createProximitySession, nearbyActions } from '../../src/v2/circleProximity.js';

const makeAdapter = () => {
  const calls = { start: 0, stop: 0, subscribed: 0, unsubscribed: 0 };
  let push = null;
  return {
    calls,
    emit: (peers) => push?.(peers),
    deps: {
      startAdvertising: () => { calls.start += 1; },
      stopAdvertising: () => { calls.stop += 1; },
      subscribe: (fn) => { calls.subscribed += 1; push = fn; return () => { calls.unsubscribed += 1; push = null; }; },
    },
  };
};

describe('rule (c) — advertising is on IF AND ONLY IF the view is open', () => {
  it('starts on open, stops on close', () => {
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    expect(s.isAdvertising()).toBe(false);          // silent before anyone looks

    s.open();
    expect(s.isAdvertising()).toBe(true);
    expect(a.calls.start).toBe(1);

    s.close();
    expect(s.isAdvertising()).toBe(false);
    expect(a.calls.stop).toBe(1);
    expect(a.calls.unsubscribed).toBe(1);
  });

  it('a second open does NOT announce twice — a re-render must not double-advertise', () => {
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    s.open(); s.open(); s.open();
    expect(a.calls.start).toBe(1);
    expect(a.calls.subscribed).toBe(1);
  });

  it('close without open, and double close, are both safe', () => {
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    expect(() => { s.close(); s.close(); }).not.toThrow();
    expect(a.calls.stop).toBe(0);                   // nothing was started, so nothing to stop
    expect(s.isAdvertising()).toBe(false);
  });

  it('if stopping THROWS we still report ourselves as not advertising', () => {
    // The dangerous direction. A caller must never be told we are still announcing when we have given up
    // trying — that would make the UI claim a privacy state we cannot deliver.
    const onError = vi.fn();
    const s = createProximitySession({
      startAdvertising: () => {},
      stopAdvertising: () => { throw new Error('mdns gone'); },
      onError,
    });
    s.open();
    expect(s.isAdvertising()).toBe(true);
    s.close();
    expect(s.isAdvertising()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'stop');   // reported, not swallowed
  });

  it('if STARTING throws we stay open but never claim to be advertising', () => {
    // No mDNS module, Wi-Fi off, permission denied. Being undiscoverable is the safe failure: you can
    // still SEE others, you are just not announcing — and the flag says so.
    const onError = vi.fn();
    const s = createProximitySession({
      startAdvertising: () => { throw new Error('no permission'); },
      stopAdvertising: () => {},
      onError,
    });
    s.open();
    expect(s.isOpen()).toBe(true);
    expect(s.isAdvertising()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'start');
  });

  it('a LATE peer callback after close cannot repopulate a closed session', () => {
    // Adapters do not always tear down cleanly. A stale callback must not make a closed session look live.
    const a = makeAdapter();
    const s = createProximitySession({ ...a.deps, subscribe: (fn) => { a.deps.subscribe(fn); return () => {}; } });
    s.open();
    a.emit([{ pubKey: 'pk-anna' }]);
    expect(s.peers()).toHaveLength(1);

    s.close();
    a.emit([{ pubKey: 'pk-bram' }]);                // the adapter did not stop cleanly
    expect(s.peers()).toEqual([]);
  });

  it('closing DROPS the peer list — a closed session keeps no record of who was around', () => {
    // Deliberate: retaining it would leave a quiet trace of the places someone has been, which is the
    // thing rule (c) exists to prevent.
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    s.open();
    a.emit([{ pubKey: 'pk-anna' }, { pubKey: 'pk-bram' }]);
    expect(s.peers()).toHaveLength(2);
    s.close();
    expect(s.peers()).toEqual([]);
  });

  it('open → close → open works, and the second round is a fresh list', () => {
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    s.open(); a.emit([{ pubKey: 'pk-anna' }]); s.close();
    s.open();
    expect(a.calls.start).toBe(2);
    expect(s.peers()).toEqual([]);                  // yesterday's neighbours are not today's
  });

  it('watchers are told when the list empties on close, not left showing stale rows', () => {
    const a = makeAdapter();
    const s = createProximitySession(a.deps);
    const seen = [];
    s.subscribeToPeers((p) => seen.push(p.length));
    s.open();
    a.emit([{ pubKey: 'pk-anna' }]);
    s.close();
    expect(seen).toEqual([1, 0]);
  });

  it('works without a subscribe adapter — advertising is still governed', () => {
    const calls = { start: 0, stop: 0 };
    const s = createProximitySession({
      startAdvertising: () => { calls.start += 1; },
      stopAdvertising: () => { calls.stop += 1; },
    });
    s.open();
    expect(s.isAdvertising()).toBe(true);
    s.close();
    expect(calls).toEqual({ start: 1, stop: 1 });
  });
});

describe('rule (b) — discovery ≠ membership', () => {
  const row = { id: 'pk-anna', pseudonym: 'Anna' };

  it('a nearby stranger gets only affordances that START a consented exchange', () => {
    const r = nearbyActions(row, { canInvite: true });
    expect(r.isMember).toBe(false);
    expect(r.actions).toEqual(['invite-to-circle', 'request-join']);
    // Nothing that implies an existing relationship.
    expect(r.actions).not.toContain('open-shared-circle');
    expect(r.note).toBe('nearby-not-member');       // the surface can SAY they are a stranger
  });

  it('membership comes from the ROSTER, never from proximity', () => {
    const asStranger = nearbyActions(row, { isKnownMember: () => false });
    const asMember = nearbyActions(row, { isKnownMember: (id) => id === 'pk-anna' });
    expect(asStranger.isMember).toBe(false);
    expect(asMember.isMember).toBe(true);
    expect(asMember.actions).toContain('open-shared-circle');
    expect(asMember.note).toBeNull();
  });

  it('a user who admins nothing cannot invite — but may still ask to join', () => {
    const r = nearbyActions(row, { canInvite: false });
    expect(r.actions).toEqual(['request-join']);
  });

  it('a row with no id is never treated as a member', () => {
    // Defensive: an unidentifiable peer must not slip through an `isKnownMember` that says yes to junk.
    const r = nearbyActions({ pseudonym: 'ghost' }, { isKnownMember: () => true });
    expect(r.isMember).toBe(false);
  });

  it('a malformed row does not throw — the list keeps rendering', () => {
    for (const bad of [null, undefined, {}, 'nope', 42]) {
      expect(() => nearbyActions(bad, { canInvite: true })).not.toThrow();
      expect(nearbyActions(bad).isMember).toBe(false);
    }
  });
});
