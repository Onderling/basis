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

describe('the "+" card teaches only lines the "+" reads', () => {
  // the lines card 4 quotes, taken from its own words in each language (so a changed card is tested as it reads)
  const quoted = (tree) => [...String(tree.introDeck.plus_body.text).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  for (const [lang, tree] of [['nl', nl], ['en', en]]) {
    it(`${lang}: the example is read as an own appointment with its day, time and title, and "help" as help`, async () => {
      const { plusLineOutcome, PLUS_ACTS } = await import('../../src/v2/vandaagPlus.js');
      const [example, help] = quoted(tree);
      expect(example, 'card 4 quotes an example line').toBeTruthy();
      expect(help, 'card 4 quotes the help word').toBeTruthy();
      const now = new Date(2026, 10, 17, 9, 0).getTime();
      const o = plusLineOutcome(example, { circles: [], lang, now });
      const appt = PLUS_ACTS.find((a) => a.fields.some((f) => f.kind === 'datetime'));
      expect(o?.kind, example).toBe('own');
      expect(o?.actId, example).toBe(appt.id);
      const when = Object.entries(o.values).find(([k]) => appt.fields.find((f) => f.name === k)?.kind === 'datetime')?.[1];
      expect(when, 'tomorrow at 14:00').toBe('2026-11-18T14:00');
      expect(Object.values(o.values).join(' '), 'the title').toMatch(/kapper|hairdresser/);
      expect(plusLineOutcome(help, { circles: [], lang })?.kind, help).toBe('help');
    });
  }
});
