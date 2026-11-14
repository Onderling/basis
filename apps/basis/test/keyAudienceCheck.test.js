/**
 * The audience round's decisions, on a fake producer and a fake read (the real path is keyAudienceCheck.relay.test.js):
 * revoke-only, one rotation per round, the controller and this device's own key kept, unmapped and cannot-place kept and
 * counted, a read that fails revokes nothing, a recipient-sealed circle said once, a non-owner does nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkKeyAudience } from '../src/v2/keyAudienceCheck.js';

function fakeProducer(recipients, { ownsRoot = true } = {}) {
  const file = { recipients: [...recipients] };
  const revoked = [];
  return {
    ownsRoot, controllerPublicKey: 'controller', persist: vi.fn(async () => {}),
    sealingIdentity: { publicKey: async () => 'own' },
    controlAgent: {
      keyStore: { read: async () => file },
      revokeRecipient: async ({ publicKey }) => { revoked.push(publicKey); file.recipients = file.recipients.filter((k) => k !== publicKey); return { rotated: true }; },
    },
    revoked, file,
  };
}
const quiet = { info: () => {}, warn: () => {} };
const statusOf = (map) => async (_c, keys) => ({ holders: keys.map((key) => ({ key, people: map[key]?.people ?? 1, status: map[key]?.status ?? 'unmapped' })) });

describe('the audience round', () => {
  it('revokes ONE out holder per round, keeps the controller, its own key and everyone in', async () => {
    const p = fakeProducer(['controller', 'own', 'bea', 'cas', 'dan']);
    const asked = [];
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', log: quiet,
      holdersStatus: async (c, keys) => { asked.push(...keys); return statusOf({ bea: { status: 'in' }, cas: { status: 'out' }, dan: { status: 'out' } })(c, keys); } });
    expect(asked, 'the controller and its own key are never asked about').toEqual(['bea', 'cas', 'dan']);
    expect(p.revoked).toEqual(['cas']);
    expect(r.counts).toMatchObject({ found: 5, revoked: 1 });
    expect(p.persist).toHaveBeenCalled();
    const r2 = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', log: quiet, holdersStatus: statusOf({ bea: { status: 'in' }, dan: { status: 'out' } }) });
    expect(p.revoked, 'the next one on the next round').toEqual(['cas', 'dan']);
    expect(r2.revoked).toBe(1);
  });

  it('keeps and counts a key nobody can name, one it cannot place, and one that maps to several people', async () => {
    const p = fakeProducer(['controller', 'x', 'y', 'z']);
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', log: quiet,
      holdersStatus: statusOf({ x: { status: 'unmapped', people: 0 }, y: { status: 'cannot-place' }, z: { status: 'in', people: 2 } }) });
    expect(p.revoked).toEqual([]);
    expect(r.counts).toMatchObject({ unmapped: 1, cannotPlace: 1, severalPeople: 1, revoked: 0 });
  });

  it('a read that fails revokes nothing that round', async () => {
    const p = fakeProducer(['controller', 'bea']);
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', log: quiet, holdersStatus: async () => { throw new Error('down'); } });
    expect(p.revoked).toEqual([]);
    expect(r).toMatchObject({ checked: false, reason: 'cannot-read' });
    const r2 = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', log: quiet, holdersStatus: async () => ({ holders: [] }) });
    expect(r2.reason, 'an answer that does not cover every key is no answer').toBe('cannot-read');
  });

  it('a recipient-sealed circle is skipped out loud, once; a device that does not own the root does nothing', async () => {
    const notes = [];
    const p = fakeProducer(['controller', 'bea']);
    const ask = vi.fn();
    await checkKeyAudience({ circleId: 'p3-circle', producer: p, storagePosture: 'p3', holdersStatus: ask, refusals: { note: (n) => notes.push(n) }, log: quiet });
    await checkKeyAudience({ circleId: 'p3-circle', producer: p, storagePosture: 'p3', holdersStatus: ask, refusals: { note: (n) => notes.push(n) }, log: quiet });
    expect(notes.map((n) => n.reason)).toEqual(['audience-not-checked']);
    expect(ask).not.toHaveBeenCalled();
    const member = fakeProducer(['controller', 'bea'], { ownsRoot: false });
    expect((await checkKeyAudience({ circleId: 'c', producer: member, storagePosture: 'p2', holdersStatus: ask, log: quiet })).reason).toBe('not-the-key-owner');
    expect(ask).not.toHaveBeenCalled();
  });
});
