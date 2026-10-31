/**
 * The registry carrier is last-write-wins for the whole resource — except tombstones: a device record that is revoked
 * on either side stays revoked, so a device that never saw a revoke cannot undo it by writing. Nothing else merges.
 */
import { describe, it, expect } from 'vitest';
import { unionTombstones } from '../../src/v2/registryCarrier.js';

const body = (agents, updatedAt = 't') => ({ updatedAt, agents });
const agent = (agentId, devices, extra = {}) => ({ agentId, ...extra, properties: { deviceDelegations: { mode: 'own', value: devices } } });

describe('tombstones are monotone', () => {
  it('a revoked record on the other side stays revoked here; a live record here does not revive it', () => {
    const mine = body([agent('default', { d1: { pubKey: 'k1' }, d2: { pubKey: 'k2' } }, { name: 'mine' })]);
    const theirs = body([agent('default', { d1: { pubKey: 'k1', revoked: true } }, { name: 'theirs' })]);
    const out = unionTombstones(mine, theirs);
    expect(out.agents[0].properties.deviceDelegations.value.d1.revoked).toBe(true);
    expect(out.agents[0].properties.deviceDelegations.value.d1.pubKey, 'the signed fields kept').toBe('k1');
    expect(out.agents[0].properties.deviceDelegations.value.d2.revoked, 'a live record not on the other side stays live').toBeUndefined();
    expect(out.agents[0].name, 'nothing else merges: the rest is this side\'s').toBe('mine');
  });
  it('a tombstone for a record this side never had is carried; an agent this side lacks is not added back', () => {
    const out = unionTombstones(body([agent('default', {})]), body([agent('default', { d9: { pubKey: 'k9', revoked: true } }), agent('p-aaaaaaaaaaaa', { d3: { revoked: true } })]));
    expect(out.agents.map((a) => a.agentId)).toEqual(['default']);
    expect(out.agents[0].properties.deviceDelegations.value.d9).toEqual({ pubKey: 'k9', revoked: true });
  });
  it('the signed revocation goes with the flag (else the tombstone never travels on the device-map carry)', () => {
    const rv = { profileId: 'default', deviceId: 'd1', by: 'auth', sig: 'rv' };
    const live = unionTombstones(body([agent('default', { d1: { pubKey: 'k1' } })]), body([agent('default', { d1: { pubKey: 'k1', revoked: true, revocation: rv } })]));
    expect(live.agents[0].properties.deviceDelegations.value.d1.revocation, 'onto a live record').toEqual(rv);
    const bare = unionTombstones(body([agent('default', { d1: { pubKey: 'k1', revoked: true } })]), body([agent('default', { d1: { pubKey: 'k1', revoked: true, revocation: rv } })]));
    expect(bare.agents[0].properties.deviceDelegations.value.d1.revocation, 'onto a tombstone that lacked it').toEqual(rv);
  });
  it('nothing to carry → the same body (no needless write)', () => {
    const mine = body([agent('default', { d1: { pubKey: 'k1' } })]);
    expect(unionTombstones(mine, body([agent('default', { d1: { pubKey: 'k1' } })]))).toBe(mine);
    expect(unionTombstones(mine, null)).toBe(mine);
  });
});
