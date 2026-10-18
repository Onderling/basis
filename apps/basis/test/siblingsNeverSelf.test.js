/**
 * My other devices never include THIS device: an address of mine the row still lists in a circle — one the circle's
 * own `circleAddressFor` does not name there (a rotated or not-yet-bound one) — is mine, not a sibling's. Sent to, it
 * came back to this device's own sender check and was refused ("not on its roster"): a self-send nobody meant, on
 * every own-device fan (the circle follow, the grants and known-peers carry).
 */
import { describe, it, expect } from 'vitest';
import { siblingDevices } from '../src/v2/grantsRail.js';

const ME = 'me-chat-key';
const roster = { c1: [{ webid: ME, circleAddresses: ['mine-in-c1-now', 'mine-in-c1-before', 'phone-in-c1'] }, { webid: 'bob', circleAddresses: ['bob-c1'] }] };
const callSkill = async (_app, op, args) => (op === 'listMyCircles' ? { circles: ['c1'] } : { members: roster[args.groupId] ?? [] });
const OWN = new Set(['mine-in-c1-now', 'mine-in-c1-before']);

describe('my other devices', () => {
  it('leave out every address this device holds a key for, not only the one circleAddressFor names', async () => {
    const rows = await siblingDevices({ callSkill, selfPubKey: ME, circleAddressFor: () => 'mine-in-c1-now', isOwnAddress: (a) => OWN.has(a) });
    expect(rows.map((r) => r.address)).toEqual(['phone-in-c1']);
  });
});
