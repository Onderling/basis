/**
 * Who a device knows on the wire, by KEY only: its own selves and devices, the members of circles it is in (their
 * webid, signing key and per-circle address), and its contact book. Never a handle or a display name. Computed at
 * call time from those sources, never a stored list.
 */
import { describe, it, expect } from 'vitest';
import { makeIsKnownPeer } from '../../src/v2/knownPeer.js';

const sources = (o = {}) => makeIsKnownPeer({
  isSelf: (k) => k === 'me',
  ownDeviceAddresses: async () => ['dev-2'],
  myCircleIds: async () => ['c1'],
  rosterOf: async (cid) => (cid === 'c1' ? [{ webid: 'ann-web', pubKey: 'ann-key', circleAddress: 'ann-c1', handle: 'anna', displayName: 'Anna' }] : []),
  contacts: async () => [{ webid: 'bo-web', pubKey: 'bo-key', peerAddr: 'bo-addr', handle: 'bo' }],
  ...o,
});

describe('makeIsKnownPeer', () => {
  it('knows its selves, its devices, its co-members and its contacts by key', async () => {
    const isKnown = sources();
    for (const k of ['me', 'dev-2', 'ann-web', 'ann-key', 'ann-c1', 'bo-web', 'bo-key', 'bo-addr']) expect(await isKnown(k), k).toBe(true);
  });
  it('a handle or display name is not a key', async () => {
    const isKnown = sources();
    for (const k of ['anna', 'Anna', 'bo']) expect(await isKnown(k), k).toBe(false);
  });
  it('a stranger is not known', async () => {
    expect(await sources()('stranger-key')).toBe(false);
    expect(await sources()('')).toBe(false);
  });
  it('a source that fails does not make a stranger known, and does not hide the others', async () => {
    const isKnown = sources({ rosterOf: async () => { throw new Error('down'); } });
    expect(await isKnown('ann-key')).toBe(false);
    expect(await isKnown('bo-key')).toBe(true);
  });
});
