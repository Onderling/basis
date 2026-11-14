/**
 * The audience round's decisions, on a fake producer (the real path is keyAudienceCheck.relay.test.js): a key's holder is
 * only who THIS device's grant notes name; revoke-only, one rotation per round, the status asked again inside the write,
 * the controller and this device's own key kept, unnoted and cannot-place kept and counted, a read that fails revokes
 * nothing, a recipient-sealed circle said once, a non-owner does nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkKeyAudience } from '../src/v2/keyAudienceCheck.js';

function fakeProducer(recipients, notes = {}, { ownsRoot = true, stillOutSeen = [] } = {}) {
  const file = { recipients: [...recipients] };
  const revoked = [];
  const n = { ...notes };
  return {
    ownsRoot, controllerPublicKey: 'controller', persist: vi.fn(async () => {}),
    sealingIdentity: { publicKey: async () => 'own' },
    keyHolders: { of: (k) => n[k] ?? null, forget: async (k) => { delete n[k]; } },
    controlAgent: {
      keyStore: { read: async () => file },
      revokeRecipient: async ({ publicKey, stillOut }) => {
        const go = typeof stillOut === 'function' ? await stillOut() : true;
        stillOutSeen.push(go);
        if (go !== true) return { rotated: false };
        revoked.push(publicKey); file.recipients = file.recipients.filter((k) => k !== publicKey); return { rotated: true };
      },
    },
    revoked, file, notes: n,
  };
}
const quiet = { info: () => {}, warn: () => {} };

describe('the audience round', () => {
  it('revokes ONE noted holder who is out per round; keeps the controller, its own key and members who are in', async () => {
    const p = fakeProducer(['controller', 'own', 'kb', 'kc', 'kd'], { kb: 'bea', kc: 'cas', kd: 'dan' });
    const asked = [];
    const status = { bea: 'in', cas: 'out', dan: 'out' };
    const memberStatusOf = async (_c, w) => { asked.push(w); return status[w]; };
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', memberStatusOf, log: quiet });
    expect(p.revoked).toEqual(['kc']);
    expect(p.notes.kc, 'the revoke removes its note').toBeUndefined();
    expect(r.counts).toMatchObject({ found: 5, revoked: 1 });
    expect(asked).not.toContain('controller');
    const r2 = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', memberStatusOf, log: quiet });
    expect(p.revoked, 'the next one on the next round').toEqual(['kc', 'kd']);
    expect(r2.revoked).toBe(1);
  });

  it('asks again inside the write: a holder re-admitted between the read and the write is not rotated out', async () => {
    const seen = [];
    const p = fakeProducer(['controller', 'kc'], { kc: 'cas' }, { stillOutSeen: seen });
    let calls = 0;
    const memberStatusOf = async () => (calls++ === 0 ? 'out' : 'in');   // out at the read, in again at the write
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', memberStatusOf, log: quiet });
    expect(seen).toEqual([false]);
    expect(p.revoked).toEqual([]);
    expect(r.revoked).toBe(0);
  });

  it('keeps and counts a key no grant here noted, and one it cannot place', async () => {
    const p = fakeProducer(['controller', 'kx', 'ky'], { ky: 'yan' });
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', memberStatusOf: async () => null, log: quiet });
    expect(p.revoked).toEqual([]);
    expect(r.counts).toMatchObject({ unmapped: 1, cannotPlace: 1, revoked: 0 });
  });

  it('a read that fails revokes nothing that round', async () => {
    const p = fakeProducer(['controller', 'kb'], { kb: 'bea' });
    const r = await checkKeyAudience({ circleId: 'c', producer: p, storagePosture: 'p2', memberStatusOf: async () => { throw new Error('down'); }, log: quiet });
    expect(p.revoked).toEqual([]);
    expect(r).toMatchObject({ checked: false, reason: 'cannot-read' });
  });

  it('a recipient-sealed circle is skipped out loud, once per circle per start; a device that does not own the root does nothing', async () => {
    const notes = [];
    const p = fakeProducer(['controller', 'kb'], { kb: 'bea' });
    const ask = vi.fn();
    await checkKeyAudience({ circleId: 'p3-circle', producer: p, storagePosture: 'p3', memberStatusOf: ask, refusals: { note: (x) => notes.push(x) }, log: quiet });
    await checkKeyAudience({ circleId: 'p3-circle', producer: p, storagePosture: 'p3', memberStatusOf: ask, refusals: { note: (x) => notes.push(x) }, log: quiet });
    expect(notes.map((x) => x.reason)).toEqual(['audience-not-checked']);
    expect(ask).not.toHaveBeenCalled();
    const member = fakeProducer(['controller', 'kb'], { kb: 'bea' }, { ownsRoot: false });
    expect((await checkKeyAudience({ circleId: 'c', producer: member, storagePosture: 'p2', memberStatusOf: ask, log: quiet })).reason).toBe('not-the-key-owner');
  });
});
