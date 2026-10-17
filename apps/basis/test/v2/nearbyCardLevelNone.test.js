/**
 * At the room self's level `none` the room is told nothing: no card goes out, whatever was typed — refused `level-none`
 * before anything is sent (a face is none too: nearbyIdentity). Above none a typed card goes as typed.
 */
import { describe, it, expect } from 'vitest';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';

const screenAt = (level, sent) => createNearbyScreen({
  allows: { card: true, chat: false },
  askChannel: { broadcastKind: async (kind, body) => { sent.push({ kind, body }); return { sent: 1 }; } },
  roomLevel: async () => level,
  t: (k) => k,
});

describe('the card at level none', () => {
  it('is refused, nothing sent', async () => {
    const sent = [];
    expect(await screenAt('none', sent).showCard({ label: 'Frits', line: 'hoi' })).toMatchObject({ ok: false, reason: 'level-none' });
    expect(sent).toEqual([]);
  });
  it('above none a typed card goes as typed', async () => {
    const sent = [];
    expect((await screenAt('handle', sent).showCard({ label: 'Frits', line: 'hoi' })).ok).toBe(true);
    expect(sent[0]?.body?.card?.label).toBe('Frits');
  });
});
