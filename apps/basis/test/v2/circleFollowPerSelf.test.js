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

  it("the catch-up answer tells each circle only to a device of that circle's self", async () => {
    const sent = [];
    const sync = createCircleFollowSync({
      siblings: async (circleId) => (circleId === 'persona-circle' ? ['persona-sibling'] : circleId ? ['default-sibling'] : ['default-sibling', 'persona-sibling']),
      sendToPeer: async (to, payload) => { sent.push({ to, id: payload.circle.id }); },
      myEntries: async () => [
        { id: 'default-circle', address: 'a1' },
        { id: 'persona-circle', address: 'a2', persona: 'p-000000000001' },
      ],
      myLeft: async () => ['left-default-circle'],
      isIn: async () => false, consume: async () => ({}),
    });
    const ask = sync.handlers['device-circles-request'];
    await ask('persona-sibling', { subtype: 'device-circles-request' });
    expect(sent, "the persona's device hears the persona's circle, never the general persona's").toEqual([{ to: 'persona-sibling', id: 'persona-circle' }]);
    sent.length = 0;
    await ask('default-sibling', { subtype: 'device-circles-request' });
    expect(sent, "the general persona's device hears its circles (joined and left), never the persona's").toEqual([
      { to: 'default-sibling', id: 'default-circle' }, { to: 'default-sibling', id: 'left-default-circle' },
    ]);
  });
});
