/**
 * The follow fans are per circle: leaving (or putting away) a circle is told only to the siblings of THAT circle's
 * self — a persona's circle never to the default's devices (no person-level lane on the wire).
 */
import { describe, it, expect } from 'vitest';
import { createCircleFollowSync } from '../../src/v2/circleFollowSync.js';

describe('circle follow — siblings per circle', () => {
  it('fanLeft asks for the circle\'s own siblings and sends only to them', async () => {
    const asked = [];
    const sent = [];
    const sync = createCircleFollowSync({
      siblings: async (circleId) => { asked.push(circleId ?? null); return circleId === 'persona-circle' ? [] : ['default-sibling']; },
      sendToPeer: async (to, payload) => { sent.push({ to, payload }); },
      myEntries: async () => [], isIn: async () => false, consume: async () => ({}),
    });
    expect((await sync.fanLeft('persona-circle')).attempted).toBe(0);
    expect(sent).toEqual([]);
    expect((await sync.fanLeft('default-circle')).attempted).toBe(1);
    expect(sent.map((x) => x.to)).toEqual(['default-sibling']);
    expect(asked).toEqual(['persona-circle', 'default-circle']);
  });
});
