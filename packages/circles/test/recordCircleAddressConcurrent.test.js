/**
 * Two announcements for one member landing at once (a new address, and the ceremony commitment) both stick: the
 * row's patch is a read-modify-write, and run side by side the second would write back the source it read before
 * the first one's write — the first patch lost. One at a time per row, each sees the one before it.
 */
import { describe, it, expect } from 'vitest';
import { recordCircleAddress } from '../src/circleAddress.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
function slowStore(rows) {
  return {
    async listOpen({ type } = {}) { await tick(); return rows.filter((r) => !type || r.type === type).map((r) => structuredClone(r)); },
    async update(id, patch) { await tick(); const r = rows.find((x) => x.id === id); Object.assign(r, structuredClone(patch)); return r; },
    async addItems(items) { await tick(); rows.push(...items.map((i) => ({ id: `n${rows.length}`, ...i }))); return items; },
  };
}
const proven = (args) => ({ ...args });   // the proof check is not what is under test here

describe('recordCircleAddress — concurrent announcements for one member', () => {
  it('a new address and the ceremony commitment, landing together, are both on the row', async () => {
    const rows = [{ id: 'r1', type: 'membership-redemption', source: { groupId: 'g', redeemedBy: 'pk-bram', circleAddress: 'addr-1', circleAddressProof: 'p1' } }];
    const store = slowStore(rows);
    const deps = { store, verifyCircleAddressAnnouncement: proven, simulateSync: () => ({}) };
    await Promise.all([
      recordCircleAddress(deps, { a: { groupId: 'g', circleAddress: 'addr-2', circleAddressProof: 'p2' }, from: 'pk-bram', localActor: 'pk-me' }),
      recordCircleAddress(deps, { a: { groupId: 'g', circleAddress: 'addr-1', circleAddressProof: 'p1', ceremonyCommitment: 'cc', ceremonyCommitmentProof: 'ccp' }, from: 'pk-bram', localActor: 'pk-me' }),
    ]);
    const src = rows[0].source;
    expect(src.ceremonyCommitment, JSON.stringify(src)).toBe('cc');
    const addrs = [src.circleAddress, ...(src.circleAddresses ?? []).map((p) => p.address)];
    expect(addrs, JSON.stringify(src)).toContain('addr-2');
  });
});
