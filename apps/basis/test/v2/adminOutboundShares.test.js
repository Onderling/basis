/**
 * The admin panel's "what this circle shared out" — one decision both shells paint: the (item, target circle) pairs,
 * and whether this circle may take a share back in place (only a `canonical` posture revokes in place; any other share
 * is a separate object, said instead). And the words for what a "Stop sharing" answered.
 */
import { describe, it, expect } from 'vitest';
import { adminOutboundShares, stopShareWords, memberRevokeWords } from '../../src/v2/circleShare.js';


describe('adminOutboundShares', () => {
  it('lists through the shared scan, and revocable only for a canonical circle', async () => {
    const seen = [];
    const resolveService = async (cid) => { seen.push(cid); return null; };
    const canonical = await adminOutboundShares({ resolveService, fromCircleId: 'a', circleIds: ['a', 'b'], policy: { sharePosture: 'canonical' } });
    expect(canonical).toEqual({ shares: [], revocable: true });
    expect(seen).toEqual(['b']);   // never the source circle itself
    const copy = await adminOutboundShares({ resolveService, fromCircleId: 'a', circleIds: ['b'], policy: { sharePosture: 'copy' } });
    expect(copy.revocable).toBe(false);
  });
  it('a failing read is an empty list, never a throw (the section hides, the panel stands)', async () => {
    const r = await adminOutboundShares({ resolveService: async () => { throw new Error('x'); }, fromCircleId: 'a', circleIds: ['b'], policy: null });
    expect(r).toEqual({ shares: [], revocable: false });
  });
});

describe('stopShareWords', () => {
  it('taken back, or why not', () => {
    expect(stopShareWords({ ok: true }, { itemId: 'i', toCircleId: 'b' })).toEqual({ key: 'circle.share.revoked', params: { item: 'i', recipient: 'b' } });
    expect(stopShareWords({ ok: false, error: 'not-canonical' }, { itemId: 'i', toCircleId: 'b' })).toEqual({ key: 'circle.share.revoke_failed', params: { error: 'not-canonical' } });
  });
});

describe('memberRevokeWords', () => {
  it('a removal that took shares back says how many; a failure wins; nothing to take back is null', () => {
    expect(memberRevokeWords({ revoked: 2, failed: [] })).toEqual({ key: 'circle.share.member_revoked', params: { count: 2 } });
    expect(memberRevokeWords({ revoked: 1, failed: ['x'] })).toEqual({ key: 'circle.share.member_revoke_failed', params: { count: 1 } });
    expect(memberRevokeWords({ revoked: 0, failed: [] })).toBe(null);
  });
});
