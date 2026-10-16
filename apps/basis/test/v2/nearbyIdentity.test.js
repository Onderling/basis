/**
 * What the Nearby room is told about you — the FACE (a label: your name, your handle, or nobody) and, on "share how to
 * reach me", your ADDRESSES (the relay you ride; the NKN address only behind the publication lock) — decided once,
 * shared by both shells; a shell only hands in where its face choice is stored and how its relay is found.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyIdentity, nearbyFaceChoice } from '../../src/v2/nearbyIdentity.js';

const profile = { entry: { displayName: 'Frits', handle: 'frits' } };
const callSkill = async (app, op) => (app === 'stoop' && op === 'getMyProfile' ? profile : null);

describe('the Nearby identity', () => {
  it('the face follows the choice: name (the default), handle, or nobody', async () => {
    const face = (choice) => createNearbyIdentity({ readChoice: () => choice, callSkill }).myFace();
    expect(await face('name')).toEqual({ label: 'Frits' });
    expect(await face('handle')).toEqual({ label: 'frits' });
    expect(await face('none')).toBe(null);
    expect(await face('weird')).toEqual({ label: 'Frits' });   // an unknown choice reads as the default
    expect(nearbyFaceChoice('handle')).toBe('handle');
    expect(nearbyFaceChoice(undefined)).toBe('name');
  });
  it('the addresses: the relay always (when there is one), NKN only behind the lock', async () => {
    const ids = (shareNkn) => createNearbyIdentity({ readChoice: () => 'name', callSkill, relayUrl: async () => 'wss://r', shareNkn: () => shareNkn, nknAddress: () => 'nkn.addr' }).myAddresses();
    expect(await ids(true)).toEqual({ relay: { url: 'wss://r' }, nkn: { address: 'nkn.addr' } });
    expect(await ids(false)).toEqual({ relay: { url: 'wss://r' } });
    const none = createNearbyIdentity({ readChoice: () => 'name', callSkill, relayUrl: async () => null, shareNkn: () => { throw new Error('broken'); }, nknAddress: () => 'x' });
    expect(await none.myAddresses(), 'a broken lock stays closed; no relay is honest').toEqual({});
  });
});
