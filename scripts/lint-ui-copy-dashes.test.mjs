import { describe, it, expect } from 'vitest';
import { dashHits } from './lint-ui-copy-dashes.mjs';

describe('lint-ui-copy-dashes', () => {
  it('flags a spaced em dash, en dash or hyphen joining two clauses (red fixture)', () => {
    const hits = dashHits({
      a: { text: 'Wat je deelt — en met wie' },
      b: { text: 'Klaar – ga verder' },
      c: { text: 'Opslaan - of niet' },
    });
    expect(hits.map((h) => h.key)).toEqual(['a.text', 'b.text', 'c.text']);
  });

  it('passes plain sentences, ranges without spaces, a lone dash, a hyphen in a word, and doc notes (green fixture)', () => {
    expect(dashHits({
      a: { text: 'Open van 9–17 uur.' },
      b: { text: '—' },
      c: { text: 'Stuur een e-mail.' },
      d: { text: 'Plain sentence.', doc: 'A note — for translators, not copy.' },
    })).toEqual([]);
  });

  it('reads the real tree without throwing (the parser cannot go blind silently)', async () => {
    const { readFileSync } = await import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../apps/basis/src/locales/circle.nl.json', import.meta.url), 'utf8'));
    expect(Array.isArray(dashHits(json))).toBe(true);
  });
});
