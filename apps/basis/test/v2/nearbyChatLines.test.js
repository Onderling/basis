// The room chat's lines say who said them and when (Frits's own test: without them "very hard to read").
import { describe, it, expect } from 'vitest';
import { nearbyChatLines } from '../../src/v2/nearbyScreen.js';
import { timeWords } from '../../src/v2/whenWords.js';

const t = (k) => k;
const at = Date.UTC(2026, 10, 17, 9, 5);

describe('nearbyChatLines', () => {
  it('my own line says "you" and its time', () => {
    const [l] = nearbyChatLines([{ id: 'a', text: 'hoi', from: 'me-addr', createdAt: at }], { me: 'me-addr', t });
    expect(l).toMatchObject({ id: 'a', text: 'hoi', who: 'circle.nearbyScreen.chat_you', when: timeWords(at), mine: true });
  });
  it("another's line carries the name their row shows (a face, else their own name)", () => {
    const [l] = nearbyChatLines([{ id: 'b', text: 'ja', from: 'peerXYZ123', receivedAt: at }], { rows: [{ id: 'peerXYZ123', pseudonym: 'Ans' }], me: 'me-addr', t });
    expect(l).toMatchObject({ who: 'Ans', when: timeWords(at), mine: false });
  });
  it('without a row, the same peer-… the person rows use', () => {
    const [l] = nearbyChatLines([{ id: 'c', text: 'x', from: 'abcdef123456', receivedAt: at }], { me: 'me-addr', t });
    expect(l.who).toBe('peer-abcdef');
  });
  it('no sender at all: the shared "someone" words', () => {
    const [l] = nearbyChatLines([{ id: 'd', text: 'x', from: null, receivedAt: at }], { t });
    expect(l.who).toBe('circle.reply.who_someone');
  });
});
