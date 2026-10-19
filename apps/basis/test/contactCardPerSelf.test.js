/**
 * MY CARD RIDES THE FIRST TURN TO A CONTACT — PER SELF. A contact switched to another persona hears that persona's
 * card on the very next turn, in the same session; before, "had my card" was remembered per contact only, so the
 * persona's card waited for a new session and the contact kept the old self's.
 */
import { describe, it, expect } from 'vitest';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';

function memItemStore() {
  const items = [];
  return {
    items,
    addItems: async (drafts) => { const p = drafts.map((d, i) => ({ id: `id-${items.length + i}`, addedAt: Date.now(), ...d })); items.push(...p); return p; },
    listOpen: async () => items.slice(),
  };
}

describe('the card is per self', () => {
  it('switched to a persona: that persona\'s card goes on the next turn; the same self twice: once', async () => {
    const sent = [];
    let personaId = null;   // the self this contact is filed under (null: the general persona)
    const ch = createContactThreadChannel({
      sendToPeer: async (to, payload) => { sent.push(payload); return { delivered: true }; },
      itemStore: memItemStore(),
      selfFor: async () => (personaId ? { webid: `web-${personaId}`, personaId, sendAs: `addr-${personaId}` } : null),
      myCard: async (pid) => `card-of-${pid ?? 'general'}`,
    });
    const say = async (text) => { const r = ch.sendTurn({ peerAddr: 'peer-A', threadId: 'peer-A', text }); await r.sent; };
    const cardOf = (p) => p?.extras?.card ?? p?.card ?? null;

    await say('hoi');
    await say('nog eens');
    personaId = 'p-buurt';
    await say('nu als buurman');
    await say('weer als buurman');
    expect(sent.map(cardOf)).toEqual(['card-of-general', null, 'card-of-p-buurt', null]);
  });
});
