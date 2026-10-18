/**
 * What the Nearby room is told about you — the FACE (a label: your name, your handle, or nobody) and, on "share how to
 * reach me", your ADDRESSES (the relay you ride; the NKN address only behind the publication lock) — decided once,
 * shared by both shells. The face follows the room self's LEVEL (its `nearby` disclosure), not a device setting.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyIdentity } from '../../src/v2/nearbyIdentity.js';
import { nearbyLevelWrites, NEARBY_CONTEXT } from '../../src/v2/nearbyLevel.js';

const profile = { entry: { displayName: 'Frits', handle: 'frits' } };
/** A stub registry: each self's `nearby` disclosure as the one writer would leave it at `level`. */
const disclosureAt = (level) => {
  const ctx = {};
  for (const w of nearbyLevelWrites(level)) ctx[w.key] = { enabled: w.enabled, ...(w.rung ? { rung: w.rung } : {}) };
  return { perContext: { [NEARBY_CONTEXT]: ctx } };
};
const stub = (levels = {}) => async (app, op, args) => {
  if (app === 'pinboard' && op === 'getMyProfile') return profile;
  if (app === 'agents' && op === 'getProfileDisclosure') return { disclosure: levels[args.id] ? disclosureAt(levels[args.id]) : { perContext: {} } };
  return null;
};
const callSkill = stub();

describe('the Nearby identity', () => {
  it('the face follows the level: the general persona at handle = its handle, at profile = its name; none = nobody', async () => {
    const face = (level) => createNearbyIdentity({ callSkill: stub({ default: level }), roomSelf: () => ({ id: 'default' }) }).myFace();
    expect(await face('handle')).toEqual({ label: 'frits' });
    expect(await face('profile')).toEqual({ label: 'Frits' });
    expect(await face('none')).toBe(null);
    expect(await createNearbyIdentity({ callSkill, roomSelf: () => ({ id: 'default' }) }).myFace(), 'nothing set: the floor').toEqual({ label: 'frits' });
    // no self entering (none held here): nothing shown, nothing set, nothing prefilled — never the general persona by default
    const nobody = createNearbyIdentity({ callSkill, roomSelf: () => null });
    expect(await nobody.myFace(), 'no self: no face').toBe(null);
    expect(await nobody.level()).toBe('none');
    expect(await nobody.setLevel('profile')).toEqual({ ok: false, reason: 'not-a-self-here' });
    expect(await nobody.cardPrefill()).toEqual({});
  });
  it('a persona is its own name at every level above none', async () => {
    for (const level of ['handle', 'profile']) {
      expect(await createNearbyIdentity({ callSkill: stub({ 'p-aaaaaaaaaaaa': level }), roomSelf: () => ({ id: 'p-aaaaaaaaaaaa', name: 'Werk' }) }).myFace(), level).toEqual({ label: 'Werk' });
    }
  });

  it('the addresses: the relay always (when there is one), NKN only behind the lock', async () => {
    const ids = (shareNkn) => createNearbyIdentity({ callSkill, relayUrl: async () => 'wss://r', shareNkn: () => shareNkn, nknAddress: () => 'nkn.addr' }).myAddresses();
    expect(await ids(true)).toEqual({ relay: { url: 'wss://r' }, nkn: { address: 'nkn.addr' } });
    expect(await ids(false)).toEqual({ relay: { url: 'wss://r' } });
    const none = createNearbyIdentity({ callSkill, relayUrl: async () => null, shareNkn: () => { throw new Error('broken'); }, nknAddress: () => 'x' });
    expect(await none.myAddresses(), 'a broken lock stays closed; no relay is honest').toEqual({});
  });
});
