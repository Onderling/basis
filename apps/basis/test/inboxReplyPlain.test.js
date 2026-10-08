/**
 * A reply through the contact inbox is a contact turn, and the app paints a turn as plain text — so markdown the model
 * writes (`**vet**`, `# kop`, `- punt`) would show its marks. The door sends plain text.
 */
import { describe, it, expect } from 'vitest';
import { createContactDoorBridge, plainReply } from '../src/v2/inboxDoor.js';

describe('a reply through the contact inbox', () => {
  it('goes out as plain text: emphasis marks gone, headings and bullets made readable', async () => {
    const sent = [];
    const door = createContactDoorBridge({ sendTurn: async (t) => { sent.push(t.text); } });
    await door.sendReply({ chatId: 'c1', text: '**Boodschappen:**\n- melk\n* brood\n## Vandaag\nDat is `klaar` en __goed__.' });
    expect(sent[0]).toBe('Boodschappen:\n• melk\n• brood\nVandaag\nDat is klaar en goed.');
  });
  it('leaves ordinary text alone — a single star, an underscore in a word, a times sign', () => {
    expect(plainReply('3 * 4 = 12, snake_case en *één* ster')).toBe('3 * 4 = 12, snake_case en *één* ster');
  });
});
