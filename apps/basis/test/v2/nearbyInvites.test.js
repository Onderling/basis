/**
 * Broadcasting a circle invite (Nearby step H, §5).
 *
 * This is the one thing in Nearby that discloses a GROUP rather than a person, so the tests are about the
 * three mitigations that make that safe to offer at all:
 *
 *   1. per-circle and OFF by default — never a global "share my circles";
 *   2. a hard, short expiry ceiling, because decision 4 ruled out max-uses;
 *   3. join is still a join — nothing here weakens the gate.
 */
import { describe, it, expect } from 'vitest';
import * as invites from '../../src/v2/nearbyInvites.js';
import {
  invitePublishAllows, mayPublish, prepareBroadcastInvite, isInviteLive, receiveInvite, inviteActions,
  BROADCAST_INVITE_MAX_TTL_MS, INVITE_MESSAGE, INVITE_MAX_NAME, INVITE_MAX_URI,
} from '../../src/v2/nearbyInvites.js';

const T0 = 1_700_000_000_000;
const at = (ms) => () => T0 + ms;
const URI = 'stoop-invite://abc123';

describe('per-circle, admin-only, off by default', () => {
  it('nothing is publishable until a specific circle is listed', () => {
    expect(invitePublishAllows()).toEqual({});
    expect(mayPublish({}, 'c1')).toBe(false);
    expect(mayPublish({ c1: true }, 'c1')).toBe(true);
    expect(mayPublish({ c1: true }, 'c2')).toBe(false);
  });

  it('only an explicit true counts', () => {
    expect(invitePublishAllows({ c1: 'yes', c2: 1, c3: true })).toEqual({ c3: true });
  });

  it('THERE IS NO global "publish all my circles"', () => {
    // The decision is different for a street party and a support group, so a global switch would answer it
    // wrongly for every circle but the one the user was thinking about.
    const blanket = /^(publish|share|broadcast)(All|Every)|^(all|every)Circles|Global/;
    expect(Object.keys(invites).filter((k) => blanket.test(k))).toEqual([]);
    // And the allow map is keyed BY CIRCLE — there is no shape in which one flag covers them all.
    expect(mayPublish({ c1: true }, 'c2')).toBe(false);
  });

  it('preparing is refused for a circle that was not allowed', () => {
    expect(prepareBroadcastInvite({ uri: URI, circleId: 'c1', now: at(0) }))
      .toMatchObject({ ok: false, reason: 'publish-not-allowed' });
  });
});

describe('the expiry ceiling', () => {
  const allows = { c1: true };

  it('THE MITIGATION: a long-lived invite is cut down for the room', () => {
    // Decision 4 ruled out max-uses, so expiry is the only lever — and a shout to a café is not a QR you
    // hand to one person.
    const r = prepareBroadcastInvite({
      uri: URI, circleId: 'c1', allows, expiresAt: T0 + 6 * 60 * 60_000, now: at(0),
    });
    expect(r.invite.expiresAt).toBe(T0 + BROADCAST_INVITE_MAX_TTL_MS);
  });

  it('a SHORTER invite is not extended by broadcasting it', () => {
    const r = prepareBroadcastInvite({ uri: URI, circleId: 'c1', allows, expiresAt: T0 + 60_000, now: at(0) });
    expect(r.invite.expiresAt).toBe(T0 + 60_000);
  });

  it('an invite with no expiry of its own gets the ceiling, not forever', () => {
    const r = prepareBroadcastInvite({ uri: URI, circleId: 'c1', allows, now: at(0) });
    expect(r.invite.expiresAt).toBe(T0 + BROADCAST_INVITE_MAX_TTL_MS);
  });

  it('refuses an already-expired invite', () => {
    expect(prepareBroadcastInvite({ uri: URI, circleId: 'c1', allows, expiresAt: T0 - 1, now: at(0) }))
      .toMatchObject({ ok: false, reason: 'invite-expired' });
  });

  it('refuses a missing or absurd uri', () => {
    expect(prepareBroadcastInvite({ circleId: 'c1', allows, now: at(0) })).toMatchObject({ reason: 'no-invite' });
    expect(prepareBroadcastInvite({ uri: 'x'.repeat(INVITE_MAX_URI + 1), circleId: 'c1', allows, now: at(0) }))
      .toMatchObject({ reason: 'invite-too-long' });
  });

  it('clamps the circle name and freezes the result', () => {
    const r = prepareBroadcastInvite({
      uri: URI, circleId: 'c1', circleName: 'x'.repeat(INVITE_MAX_NAME + 20), allows, now: at(0),
    });
    expect(r.invite.circleName).toHaveLength(INVITE_MAX_NAME);
    expect(Object.isFrozen(r.invite)).toBe(true);
  });
});

describe('an inbound invite is untrusted', () => {
  const inbound = (invite) => ({ kind: INVITE_MESSAGE, invite });
  const live = (over = {}) => ({ uri: URI, circleId: 'c1', circleName: 'Buurt', expiresAt: T0 + 60_000, ...over });

  it('`from` comes from the WIRE — a broadcast cannot attribute a circle to someone else', () => {
    const inv = receiveInvite(inbound(live({ from: 'someone-else' })), 'actual-sender', at(0));
    expect(inv.from).toBe('actual-sender');
  });

  it('is rebuilt — smuggled fields do not survive', () => {
    const inv = receiveInvite(inbound(live({ autoJoin: true, trusted: true })), 'them', at(0));
    expect(Object.keys(inv).sort())
      .toEqual(['circleId', 'circleName', 'expiresAt', 'from', 'receivedAt', 'uri']);
    expect(inv.autoJoin).toBeUndefined();
  });

  it('caps a distant expiry against OUR clock', () => {
    // Otherwise a peer advertises a circle in every room they ever visit, permanently.
    const inv = receiveInvite(inbound(live({ expiresAt: Number.MAX_SAFE_INTEGER })), 'them', at(0));
    expect(inv.expiresAt).toBe(T0 + BROADCAST_INVITE_MAX_TTL_MS);
  });

  it('drops an expired, malformed or wrong-kind message', () => {
    expect(receiveInvite(inbound(live({ expiresAt: T0 - 1 })), 'them', at(0))).toBeNull();
    expect(receiveInvite(inbound(live({ uri: '' })), 'them', at(0))).toBeNull();
    expect(receiveInvite(inbound(live({ circleId: '' })), 'them', at(0))).toBeNull();
    expect(receiveInvite({ kind: 'nearby.ask', invite: live() }, 'them', at(0))).toBeNull();
    expect(receiveInvite(null, 'them', at(0))).toBeNull();
  });

  it('does NOT try to verify authenticity — that is what the redeem gate is for', () => {
    // Nothing about a broadcast can establish that the publisher is really an admin or the code current.
    // A forged invite is accepted here and fails at redemption, which is where the real check lives.
    const inv = receiveInvite(inbound(live({ circleId: 'not-a-real-circle' })), 'them', at(0));
    expect(inv).not.toBeNull();
    expect(inv.circleId).toBe('not-a-real-circle');
  });
});

describe('what a received invite lets you do', () => {
  const inv = { uri: URI, circleId: 'c1', expiresAt: T0 + 60_000 };

  it('exactly one action, and it is a real join', () => {
    expect(inviteActions(inv, { now: at(0) })).toEqual({
      actions: ['join-published-circle'],
      note: 'join-is-a-join',
    });
  });

  it('there is NO "save for later"', () => {
    // A broadcast invite expires in minutes by design, so keeping one would be keeping a dead code — and a
    // record of a room you were in.
    const { actions } = inviteActions(inv, { now: at(0) });
    expect(actions.some((a) => /save|keep|later|bookmark/i.test(a))).toBe(false);
  });

  it('an expired invite offers nothing', () => {
    expect(isInviteLive(inv, at(60_001))).toBe(false);
    expect(inviteActions(inv, { now: at(60_001) })).toEqual({ actions: [], note: 'invite-expired' });
  });

  it('a malformed invite is never live', () => {
    expect(isInviteLive(null)).toBe(false);
    expect(isInviteLive({})).toBe(false);
  });
});
