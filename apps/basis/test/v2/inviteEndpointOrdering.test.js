/**
 * J-CP1 — the joiner must be ON the circle's endpoint before the redeem that needs it.
 *
 * The bug, walked on hardware 2026-07-29: `recordJoinedCirclePoints` is the only consumer of an invite's
 * `relayUrl`, and it runs from the join callback — which needs a circle id, which only exists once the
 * join has already succeeded. So a device adopted the circle's relay strictly AFTER the redeem that had
 * to travel over it. With a relay-only admin and a joiner on defaults, the redeem went out over NKN,
 * waited 15s for an HI that could never arrive, and the join died holding an invite that named the relay
 * it needed the whole time.
 *
 * It hides whenever joiner and admin happen to share a transport, which is why it survived so long. The
 * tests below are therefore mostly about ORDER, not about connecting: the dial has to have happened by
 * the time the first skill call goes out.
 */
import { describe, it, expect } from 'vitest';
import { endpointToDialForInvite } from '../../src/v2/connectionPoints.js';
import { joinCircleFromInvite } from '../../src/v2/circleInvite.js';

const RELAY = 'ws://relay.example:8787';

describe('endpointToDialForInvite — the decision', () => {
  it('returns the invite’s relay when this device is on none', () => {
    expect(endpointToDialForInvite({ invite: { relayUrl: RELAY }, activeUrl: null })).toBe(RELAY);
  });

  it('returns null when we are already there — no pointless reconnect', () => {
    expect(endpointToDialForInvite({ invite: { relayUrl: RELAY }, activeUrl: RELAY })).toBeNull();
  });

  it('returns the invite’s relay when we are on a DIFFERENT one', () => {
    expect(endpointToDialForInvite({ invite: { relayUrl: RELAY }, activeUrl: 'ws://other:8787' })).toBe(RELAY);
  });

  it('an invite with no relay asks for nothing (mDNS/NKN circles are unaffected)', () => {
    expect(endpointToDialForInvite({ invite: { groupId: 'x' }, activeUrl: null })).toBeNull();
    expect(endpointToDialForInvite({ invite: null, activeUrl: null })).toBeNull();
  });

  it('junk is not an endpoint — a typo must not tear down a working socket', () => {
    for (const relayUrl of ['', '   ', 'nope', 'https://a-pod.example', 'ws://']) {
      expect(endpointToDialForInvite({ invite: { relayUrl }, activeUrl: null })).toBeNull();
    }
  });
});

/** A callSkill that records the order of calls, and fails the redeem the way a real one does. */
function recordingCallSkill(trace, { redeemOk = true } = {}) {
  return async (app, op) => {
    trace.push(`skill:${op}`);
    if (op === 'setMyHandle') return { ok: true };
    if (op === 'redeemMembershipCode') {
      return redeemOk ? { ok: true, groupId: 'buurttest' } : { error: 'invalid-or-expired-code' };
    }
    return {};
  };
}

const INVITE = { kind: 'membershipCode', groupId: 'buurttest', code: 'abc-123', relayUrl: RELAY };

describe('the join dials before it redeems', () => {
  it('the dial happens BEFORE the first skill call — the whole point', async () => {
    const trace = [];
    await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: recordingCallSkill(trace),
      handle: 'bo',
      dialEndpoint: async (url) => { trace.push(`dial:${url}`); },
      activeEndpointUrl: null,
    });
    expect(trace[0]).toBe(`dial:${RELAY}`);
    expect(trace).toContain('skill:redeemMembershipCode');
    // …and the redeem came after it, which is the ordering the bug got wrong.
    expect(trace.indexOf(`dial:${RELAY}`)).toBeLessThan(trace.indexOf('skill:redeemMembershipCode'));
  });

  it('does not dial when the device is already on that endpoint', async () => {
    const trace = [];
    await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: recordingCallSkill(trace),
      handle: 'bo',
      dialEndpoint: async (url) => { trace.push(`dial:${url}`); },
      activeEndpointUrl: RELAY,
    });
    expect(trace.filter((t) => t.startsWith('dial:'))).toEqual([]);
  });

  it('reads the active url through a thunk, so it sees the live socket rather than a boot-time value', async () => {
    const trace = [];
    let current = 'ws://old:8787';
    await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: recordingCallSkill(trace),
      handle: 'bo',
      dialEndpoint: async (url) => { trace.push(`dial:${url}`); current = url; },
      activeEndpointUrl: () => current,
    });
    expect(trace[0]).toBe(`dial:${RELAY}`);
  });

  it('a dial FAILURE does not fail the join — the admin may be reachable another way', async () => {
    const trace = [];
    const r = await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: recordingCallSkill(trace),
      handle: 'bo',
      dialEndpoint: async () => { throw new Error('relay refused'); },
      activeEndpointUrl: null,
    });
    // The chain continued and the join completed over whatever transport was already there.
    expect(trace).toContain('skill:redeemMembershipCode');
    expect(r).toMatchObject({ ok: true, circleId: 'buurttest' });
  });

  it('no seam ⇒ unchanged behaviour, so callers that manage their own transport are untouched', async () => {
    const trace = [];
    const r = await joinCircleFromInvite({
      inviteUri: INVITE, callSkill: recordingCallSkill(trace), handle: 'bo',
    });
    expect(r).toMatchObject({ ok: true });
    expect(trace.filter((t) => t.startsWith('dial:'))).toEqual([]);
  });
});

describe('a failed join says WHY, not just that it failed', () => {
  // Until 2026-07-30 every typed failure reached a programmatic caller as a bare `join-failed`. The typed
  // reason existed at the throw site and was spent entirely on choosing a locale key, while
  // `joinCircleFromInvite` read a field those branches never set. So "this invite has expired — ask for a
  // fresh one" and "the admin is offline — try again later" were the same string, and they call for
  // opposite actions from the person joining.
  const INV = { kind: 'membershipCode', groupId: 'buurttest', code: 'abc-123', relayUrl: RELAY, adminPeerAddr: 'admin-key' };

  it('an EXPIRED code is reported as expired', async () => {
    const callSkill = async (app, op) => {
      if (op === 'setMyHandle') return { ok: true };
      if (op === 'redeemMembershipCode') return { error: 'invalid-or-expired-code' };
      return {};
    };
    // No peer fallback available, so the local refusal is the answer.
    const r = await joinCircleFromInvite({ inviteUri: INV, callSkill, handle: 'bo' });
    expect(r.reason).toBe('invalid-or-expired-code');
    expect(r.error).toMatch(/invalid-or-expired-code/);
  });

  it('an OFFLINE admin is reported as unreachable, and is not confused with an expired invite', async () => {
    const callSkill = async (app, op) => {
      if (op === 'setMyHandle') return { ok: true };
      // The local instance does not hold the code, so the chain falls back to the admin…
      if (op === 'redeemMembershipCode') return { error: 'invalid-or-expired-code' };
      return {};
    };
    // …and the admin cannot be reached.
    const sendPeerRedeem = async () => { throw new Error('peer did not respond with HI'); };
    const r = await joinCircleFromInvite({ inviteUri: INV, callSkill, sendPeerRedeem, handle: 'bo' });

    expect(r.reason, 'an offline admin still reads as a bad invite').toBe('admin-unreachable');
    // …and it carries the locale key that says the invitation is still valid, so the UI can say "later".
    expect(r.errorKey).toBe('circle.nearbyScreen.join_no_admin');
  });

  it('the two are distinguishable, which is the whole point', async () => {
    const expired = async (app, op) => (op === 'setMyHandle' ? { ok: true } : { error: 'invalid-or-expired-code' });
    const a = await joinCircleFromInvite({ inviteUri: INV, callSkill: expired, handle: 'bo' });
    const b = await joinCircleFromInvite({
      inviteUri: INV, callSkill: expired, handle: 'bo',
      sendPeerRedeem: async () => { throw new Error('offline'); },
    });
    expect(a.reason).not.toBe(b.reason);
  });

  it('a success carries no reason at all — this is not a new field on the happy path', async () => {
    const ok = async (app, op) => (op === 'redeemMembershipCode' ? { ok: true, groupId: 'buurttest' } : { ok: true });
    const r = await joinCircleFromInvite({ inviteUri: INV, callSkill: ok, handle: 'bo' });
    expect(r).toMatchObject({ ok: true, circleId: 'buurttest' });
    expect(r.reason).toBeUndefined();
  });
});
