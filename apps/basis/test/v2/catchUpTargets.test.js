/**
 * WHERE A CATCH-UP REQUEST GOES (2026-09-21). A lane's reconnect kick used to walk `listGroupRoster`, whose `addr` is the
 * member's GLOBAL webid — so circle traffic, spoken as this circle's identity, was aimed at global addresses on every
 * reconnect: the member's device answered the greeting canonically, to a per-circle address, and the requester's gate
 * refused it (the "one refusal per join" the share walk logged as L110). The fan resolves `circleAddress → … → webid`
 * behind the address-fallback setting; the catch-up now walks the same ladder: the derived roster's per-circle
 * addresses, never the caller's own row, the global key only when the person allows the fallback.
 */
import { describe, it, expect } from 'vitest';
import { catchUpTargets } from '../../src/v2/catchUpTargets.js';

const roster = {
  c1: [
    { webid: 'me', circleAddress: 'me@c1' },
    { webid: 'w1', circleAddress: 'w1@c1', circleAddresses: ['w1@c1', 'w1b@c1'] },   // two devices, primary first
    { webid: 'w2', circleAddresses: ['w2@c1'] },                                       // proven set, no primary slot
    { webid: 'w3' },                                                                    // never announced: global key only
  ],
};
const callSkill = async (app, op, a) => (op === 'listGroupMembers' ? { members: roster[a.groupId] ?? [] } : {});

describe('catchUpTargets', () => {
  it('names each other member ONCE, at their primary per-circle address; a member without one is skipped by default', async () => {
    const t = await catchUpTargets({ callSkill, circleId: 'c1', selfWebid: 'me' });
    expect(t).toEqual([{ webid: 'w1', addr: 'w1@c1', via: 'circle-address' }, { webid: 'w2', addr: 'w2@c1', via: 'circle-address' }]);
  });
  it('the global key only when the person allows the fallback — the fan\'s rung, the same gate', async () => {
    const t = await catchUpTargets({ callSkill, circleId: 'c1', selfWebid: 'me', allowGlobal: () => true });
    expect(t.map((x) => [x.webid, x.addr, x.via])).toEqual([['w1', 'w1@c1', 'circle-address'], ['w2', 'w2@c1', 'circle-address'], ['w3', 'w3', 'webid']]);
  });
  it('a circle this device has no roster for asks nobody; a roster read that throws asks nobody', async () => {
    expect(await catchUpTargets({ callSkill, circleId: 'c9', selfWebid: 'me' })).toEqual([]);
    expect(await catchUpTargets({ callSkill: async () => { throw new Error('x'); }, circleId: 'c1' })).toEqual([]);
  });
});
