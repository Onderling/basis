/**
 * Joining a circle must also make you REACHABLE in it.
 *
 * Found on hardware 2026-07-30. A join puts you on the roster, and the roster carries your per-circle
 * address — so other members dial it. Two things have to happen for that to work, and neither was reached
 * from the join:
 *
 *   1. this device registers its per-circle address for the circle, or peers dial an address the relay has
 *      never been told about;
 *   2. the other members' circle addresses get bound to their keys from the roster, or sealing to them
 *      throws `No pubKey registered` above the transport and every message holds.
 *
 * Both already existed. Both were reached only from `CircleLauncherScreen` — its circles-load effect and its
 * circle-open effect. So they ran when you browsed the circle list and not when you joined, and a join from
 * anywhere else (a tapped invite link opens the wizard over whatever screen you were on) left a member on the
 * roster at an address their own device had never registered. Confirmed by experiment: the roster held it,
 * the relay did not, and a restart fixed it — meaning a new member was unreachable until they relaunched the
 * app, which is exactly when someone is most likely to message them.
 *
 * That was dispatch logic living in a shell (invariant 1). It now lives in `makeCircleReachable` and is
 * driven by an `onJoined` seam on `finalSubmit` — the one choke point the wizard and the programmatic path
 * share, which is the part worth pinning: putting it only on `joinCircleFromInvite` would have left the UI
 * path silently skipping it, and the UI path is the one people use.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleReachable } from '../../src/v2/householdRosterPairing.js';
import { joinCircleFromInvite } from '../../src/v2/circleInvite.js';
import { initialState, decodeInvite, finalSubmit } from '../../src/core/wizards/joinGroupState.js';

const INVITE = { kind: 'membershipCode', groupId: 'rt3', code: 'abc-123' };

/** A callSkill that joins successfully and serves a two-member roster. */
function joiningCallSkill(trace = []) {
  return async (app, op, args) => {
    trace.push(op);
    if (op === 'setMyHandle') return { ok: true };
    if (op === 'redeemMembershipCode') return { ok: true, groupId: 'rt3' };
    if (op === 'listGroupMembers') {
      return {
        members: [
          { pubKey: 'pk-cato', circleAddress: 'addr-cato' },
          { pubKey: 'pk-me',   circleAddress: 'addr-me'   },
        ],
      };
    }
    return {};
  };
}

describe('makeCircleReachable — the two steps, independently', () => {
  it('registers this device’s presence AND binds the roster keys', async () => {
    const registered = [];
    const bound = [];
    const agent = {
      callSkill: joiningCallSkill(),
      registerPeerAddress: (address, pubKey) => bound.push([address, pubKey]),
      identity: { pubKey: 'pk-me' },
    };
    const out = await makeCircleReachable({
      agent, circleId: 'rt3', registerCirclePresence: () => registered.push('called'),
    });

    expect(registered, 'presence was never registered — peers dial an address the relay does not know')
      .toEqual(['called']);
    expect(bound).toEqual([['addr-cato', 'pk-cato']]);   // my own row is skipped
    expect(out).toMatchObject({ registered: true, bound: 1 });
  });

  it('a failing registration does not prevent the binding, or vice versa', async () => {
    // Independent on purpose: half-applied reachability produces "some people can be messaged and some
    // cannot" with no visible cause, which is the worst version of this to debug.
    const bound = [];
    const agent = {
      callSkill: joiningCallSkill(),
      registerPeerAddress: (a, k) => bound.push([a, k]),
      identity: { pubKey: 'pk-me' },
    };
    const out = await makeCircleReachable({
      agent, circleId: 'rt3', registerCirclePresence: () => { throw new Error('relay down'); },
    });
    expect(out.registered).toBe(false);
    expect(out.bound, 'a failed registration swallowed the binding too').toBe(1);
  });

  it('a roster read that fails leaves the registration standing', async () => {
    const registered = [];
    const agent = {
      callSkill: async (app, op) => { if (op === 'listGroupMembers') throw new Error('offline'); return {}; },
      registerPeerAddress: () => {},
      identity: { pubKey: 'pk-me' },
    };
    const out = await makeCircleReachable({
      agent, circleId: 'rt3', registerCirclePresence: () => registered.push('called'),
    });
    expect(out).toMatchObject({ registered: true, bound: 0 });
  });

  it('no host seam ⇒ no crash, and it says so', async () => {
    const out = await makeCircleReachable({ agent: null, circleId: 'rt3' });
    expect(out).toMatchObject({ registered: false, bound: 0 });
  });
});

describe('the seam fires from the WIZARD path, not just the programmatic one', () => {
  it('finalSubmit calls onJoined with the circle just joined', async () => {
    // The bug this pins: the wizard calls `finalSubmit` directly, so a seam placed only on
    // `joinCircleFromInvite` would never fire for the surface people actually use.
    const state = initialState();
    decodeInvite(INVITE, state);
    state.handle = 'cato';
    const seen = [];
    await finalSubmit({
      state, callSkill: joiningCallSkill(), onJoined: (a) => seen.push(a),
    });
    expect(seen).toEqual([{ circleId: 'rt3' }]);
  });

  it('and from joinCircleFromInvite, which forwards it', async () => {
    const seen = [];
    const r = await joinCircleFromInvite({
      inviteUri: INVITE, callSkill: joiningCallSkill(), handle: 'cato', onJoined: (a) => seen.push(a),
    });
    expect(r).toMatchObject({ ok: true, circleId: 'rt3' });
    expect(seen).toEqual([{ circleId: 'rt3' }]);
  });

  it('it fires AFTER the redeem — registering before there is a membership is pointless', async () => {
    const trace = [];
    await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: joiningCallSkill(trace),
      handle: 'cato',
      onJoined: () => { trace.push('onJoined'); },
    });
    expect(trace.indexOf('redeemMembershipCode')).toBeLessThan(trace.indexOf('onJoined'));
  });

  it('a FAILED join does not fire it', async () => {
    const seen = [];
    const failing = async (app, op) => (op === 'setMyHandle' ? { ok: true } : { error: 'invalid-or-expired-code' });
    const r = await joinCircleFromInvite({
      inviteUri: INVITE, callSkill: failing, handle: 'cato', onJoined: (a) => seen.push(a),
    });
    expect(r.ok).toBeUndefined();
    expect(seen, 'registered an address for a circle we are not in').toEqual([]);
  });

  it('a throwing seam does not turn a completed join into a reported failure', async () => {
    const r = await joinCircleFromInvite({
      inviteUri: INVITE,
      callSkill: joiningCallSkill(),
      handle: 'cato',
      onJoined: () => { throw new Error('relay unreachable'); },
    });
    expect(r).toMatchObject({ ok: true, circleId: 'rt3' });
  });

  it('no seam at all ⇒ unchanged behaviour', async () => {
    const r = await joinCircleFromInvite({
      inviteUri: INVITE, callSkill: joiningCallSkill(), handle: 'cato',
    });
    expect(r).toMatchObject({ ok: true, circleId: 'rt3' });
  });
});
