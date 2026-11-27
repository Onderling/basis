import { describe, it, expect } from 'vitest';
import { dashHits, redMessage } from './lint-ui-copy-dashes.mjs';

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

describe('lint-ui-copy-dashes — the red message says where and what to do instead', () => {
  const files = {
    'apps/x/locales/en.json': '{\n  "a": {\n    "text": "Plain."\n  },\n  "b": {\n    "text": "Wat je deelt — en met wie"\n  }\n}\n',
    'scripts/ui-copy-dashes.baseline.json': '[\n  "apps/x/locales/en.json#a.text"\n]\n',
  };
  const read = (f) => files[f] ?? '';
  it('a new hit at the line of its text in the locale file, with a Fix line', () => {
    const msg = redMessage(['apps/x/locales/en.json#b.text'], [], read);
    expect(msg).toMatch(/apps\/x\/locales\/en\.json:6\b.*b\.text/);
    expect(msg).toMatch(/^\s*Fix: /m);
  });
  it('a stale baseline entry at its line in the baseline file, with a Fix line', () => {
    const msg = redMessage([], ['apps/x/locales/en.json#a.text'], read);
    expect(msg).toMatch(/scripts\/ui-copy-dashes\.baseline\.json:2\b/);
    expect(msg).toMatch(/^\s*Fix: .*--write/m);
  });
});
