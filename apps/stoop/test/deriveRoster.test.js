/**
 * deriveRoster — unit tests (Connectivity Phase 1, Part A / B1 regression net).
 *
 * The load-bearing assertion is the B1 regression: a COLD/empty MemberMap must
 * NOT empty the roster when the durable redemption trail has members. Also
 * covers: founder-without-a-redemption, the joiner learning the admin via
 * `confirmedBy`, display-field left-join, and key backfill from the trail.
 */
import { describe, it, expect } from 'vitest';
import { deriveRoster } from '../src/lib/deriveRoster.js';

const redemption = (over = {}) => ({
  type: 'membership-redemption',
  source: { groupId: 'g1', ...over },
});

describe('deriveRoster', () => {
  it('derives N members from N redemptions, with keys from the trail', () => {
    const roster = deriveRoster({
      redemptions: [
        redemption({ redeemedBy: 'B', signingPublicKey: 'pkB', sealingPublicKey: 'skB', circleAddress: 'addrB' }),
        redemption({ redeemedBy: 'C', signingPublicKey: 'pkC' }),
      ],
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['B', 'C']);
    const b = roster.find((m) => m.webid === 'B');
    expect(b.pubKey).toBe('pkB');
    expect(b.sealingPublicKey).toBe('skB');
    expect(b.circleAddress).toBe('addrB');
    expect(b.role).toBe('member');
  });

  it('B1 regression: a COLD/empty MemberMap still yields a full roster', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
      memberMapForDisplay: [],   // the runtime-empty cache that used to blank the roster
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['A', 'B']);
  });

  it('includes the founder (role admin) even with no redemption of their own', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
    });
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
    expect(roster.find((m) => m.webid === 'B')?.role).toBe('member');
  });

  it('joiner side: learns the admin via confirmedBy (peer channel)', () => {
    // The joiner's OWN trail: only their redemption, carrying confirmedBy=admin.
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', confirmedBy: 'A', channel: 'peer', signingPublicKey: 'pkB' })],
    });
    expect(roster.map((m) => m.webid).sort()).toEqual(['A', 'B']);
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
    expect(roster.find((m) => m.webid === 'B')?.role).toBe('member');
  });

  it('joiner side: the admin row carries their per-circle address + signing key', () => {
    // Recorded (proof-verified) by `recordRemoteRedemption` when the redeem RESPONSE carried it. Without
    // both halves a send to the admin falls through to their global key — refused when the per-user
    // address fallback is off — and the address cannot be bound to an identity key for sealing.
    const roster = deriveRoster({
      redemptions: [redemption({
        redeemedBy: 'B', confirmedBy: 'A', channel: 'peer', confirmedByCircleAddress: 'addrA-in-g1',
      })],
    });
    const a = roster.find((m) => m.webid === 'A');
    expect(a.circleAddress).toBe('addrA-in-g1');
    expect(a.pubKey).toBe('A');
  });

  it('ignores confirmedBy when the channel is not peer', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', confirmedBy: 'A', channel: 'intro' })],
    });
    expect(roster.map((m) => m.webid)).toEqual(['B']);
  });

  it('left-joins the MemberMap for display fields but trail owns existence + keys', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      memberMapForDisplay: [
        { webid: 'B', displayName: 'Bea', handle: 'bea', tags: ['koor'] },
        { webid: 'Z', displayName: 'Ghost' },   // in the cache but NOT the trail → excluded
      ],
    });
    expect(roster.map((m) => m.webid)).toEqual(['B']);   // Z is not a member (not in trail)
    const b = roster[0];
    expect(b.displayName).toBe('Bea');
    expect(b.handle).toBe('bea');
    expect(b.tags).toEqual(['koor']);
    expect(b.pubKey).toBe('pkB');   // trail key preserved through the join
  });

  it('backfills a missing trail key from the MemberMap (founder own keys)', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', signingPublicKey: 'pkB' })],
      founderWebids: ['A'],
      memberMapForDisplay: [{ webid: 'A', role: 'admin', circleAddress: 'addrA', sealingPublicKey: 'skA' }],
    });
    const a = roster.find((m) => m.webid === 'A');
    expect(a.role).toBe('admin');
    expect(a.circleAddress).toBe('addrA');   // filled from the display cache
    expect(a.sealingPublicKey).toBe('skA');
  });

  it('leaves an unknown key absent (undefined), never a null placeholder', () => {
    const roster = deriveRoster({
      redemptions: [redemption({ redeemedBy: 'B', sealingPublicKey: 'skB' })],
      founderWebids: ['A'],
    });
    // A has no sealingPublicKey anywhere → the key must be ABSENT, not null.
    const a = roster.find((m) => m.webid === 'A');
    expect(a.sealingPublicKey).toBeUndefined();
    expect('sealingPublicKey' in a).toBe(false);
  });

  it('never downgrades an admin to a member across rows', () => {
    const roster = deriveRoster({
      redemptions: [
        redemption({ redeemedBy: 'A', role: 'member' }),   // a stray member-role row
      ],
      founderWebids: ['A'],                                 // but A is the founder → admin
    });
    expect(roster.find((m) => m.webid === 'A')?.role).toBe('admin');
  });

  it('returns [] for a fully empty input (caller falls back to the cache)', () => {
    expect(deriveRoster({})).toEqual([]);
  });
});
