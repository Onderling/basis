// A contact link the person handed out is USED ONCE across all their devices: two devices may each let on a different
// first opener before they hear of each other, and both must end on the same one, the earlier. The use is a claim,
// so it resolves first-wins on the store's claim channel, not by the content LWW (which keeps the LATER write).
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/index.js';
import { defaultResolutionRegistry, RESOLUTION } from '../src/resolutionPolicy.js';

const inbound = { origin: true, sync: false };
const mk = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://own/' });
const link = { id: 'shared-card:default:tok', type: 'shared-card', self: 'default', token: 'tok-0123456789abcdef', mintedAt: 1, expiresAt: 9_999_999 };

describe('a shared contact link: its one use is a first-wins claim across the person\'s devices', () => {
  it('the default registry declares the claim channel for shared-card', () => {
    expect(defaultResolutionRegistry().hasChannel('shared-card', RESOLUTION.CLAIM)).toBe(true);
  });

  it('two devices that each let on a different first opener converge on the EARLIER one, whatever the order', async () => {
    const a1 = mk(); const a2 = mk();
    // both devices hold the unused link (it rode the own lane)
    await a1.put({ ...link, clock: 1, updatedBy: 'me' }, inbound);
    await a2.put({ ...link, clock: 1, updatedBy: 'me' }, inbound);
    // device 1 lets Bob on at 100, device 2 (not yet having heard) lets Carol on at 200: concurrent writes
    const bob   = { ...link, assignee: 'bob',   claimedAt: 100, clock: 2, updatedBy: 'me' };
    const carol = { ...link, assignee: 'carol', claimedAt: 200, clock: 3, updatedBy: 'me' };
    await a1.put(bob, inbound);
    await a2.put(carol, inbound);
    // they exchange rows: Carol's is causally LATER (clock 3), so content LWW alone would give Carol on both
    await a1.put(carol, inbound);
    await a2.put(bob, inbound);
    expect((await a1.get(link.id)).assignee).toBe('bob');
    expect((await a2.get(link.id)).assignee).toBe('bob');
    expect((await a2.get(link.id)).claimedAt).toBe(100);
  });
});
