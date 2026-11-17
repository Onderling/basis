import { describe, it, expect } from 'vitest';
import { INTRO_CARDS, introStep, introNext } from '../../src/v2/introDeck.js';
import nl from '../../src/locales/circle.nl.json';
import en from '../../src/locales/circle.en.json';

describe('the introduction deck', () => {
  it('seven cards in the agreed order', () => {
    expect(INTRO_CARDS).toEqual(['welcome', 'circles', 'contacts', 'plus', 'selves', 'nearby', 'keys']);
  });

  it('every card turns the page with Next and can be skipped, but the last leaves with Get started', () => {
    for (let i = 0; i < INTRO_CARDS.length - 1; i += 1) {
      expect(introStep(i)).toMatchObject({ isLast: false, nextKey: 'circle.introDeck.next', skipKey: 'circle.introDeck.skip' });
      expect(introNext(i)).toBe(i + 1);
    }
    expect(introStep(6)).toMatchObject({ id: 'keys', isLast: true, nextKey: 'circle.introDeck.start', position: { at: 7, of: 7 } });
    expect(introNext(6)).toBeNull();
  });

  it('an index outside the deck is clamped into it', () => {
    expect(introStep(-3).id).toBe('welcome');
    expect(introStep(99).id).toBe('keys');
    expect(introStep('x').id).toBe('welcome');
  });

  it('every key a step names has words in Dutch and English', () => {
    const at = (tree, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], tree);
    for (let i = 0; i < INTRO_CARDS.length; i += 1) {
      const s = introStep(i);
      for (const key of [s.titleKey, s.bodyKey, s.nextKey, s.skipKey, 'circle.introDeck.position']) {
        for (const tree of [nl, en]) expect(String(at(tree, key)?.text ?? ''), key).not.toBe('');
      }
    }
  });
});
