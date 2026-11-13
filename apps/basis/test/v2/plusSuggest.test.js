import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plusSuggestionPool, plusSuggest } from '../../src/v2/vandaagPlus.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { GATE_WORDS } from '../../src/v2/gateWords.js';

// What the person can type in the "+": the gate rules' own tested examples, offered only where the "+" reads them
// with this person's circles (the circle filter: an example that would do nothing is never offered), narrowed as they
// type. Frits, walk row 55: "know what can be used in the plus-menu chat … filtered like it is within a circle".
const manifestsByOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const shopping = { name: 'boodschappen', kind: 'list', defaultChild: null, aliases: [] };

describe('the "+" suggests what it can read here', () => {
  it('offers an example only where the "+" reads it: a list phrase needs a circle that holds the list', () => {
    const none = plusSuggestionPool({ circles: [] });
    const withList = plusSuggestionPool({ circles: [{ id: 'k1', name: 'Kring', manifestsByOrigin, lists: [shopping] }] });
    expect(none).not.toContain('zet melk op de boodschappen');
    expect(withList).toContain('zet melk op de boodschappen');
  });

  it('every offered example is one the "+" reads (never a line that would do nothing)', async () => {
    const { plusLineOutcome } = await import('../../src/v2/vandaagPlus.js');
    const circles = [{ id: 'k1', name: 'Kring', manifestsByOrigin, lists: [shopping] }];
    const pool = plusSuggestionPool({ circles });
    expect(pool.length).toBeGreaterThan(3);
    for (const ex of pool) expect(plusLineOutcome(ex, { circles }), ex).toBeTruthy();
  });

  it('the examples are the gate\'s own (nothing invented here)', () => {
    const all = new Set(Object.values(GATE_WORDS).flatMap((entries) => Object.entries(entries).filter(([id]) => !id.startsWith('_')).flatMap(([, e]) => e?.examples ?? [])));
    const pool = plusSuggestionPool({ circles: [{ id: 'k1', name: 'Kring', manifestsByOrigin, lists: [shopping] }] });
    for (const ex of pool) expect(all.has(ex), ex).toBe(true);
  });

  it('narrows as the person types: every typed word starts a word of the example; at most five; nothing under two letters', () => {
    const pool = ['zet melk op de boodschappen', 'nieuwe taak: lamp vervangen', 'nieuwe taak voor mij: ramen lappen, morgen', 'tandarts morgen om 10 uur'];
    expect(plusSuggest(pool, 'n')).toEqual([]);
    expect(plusSuggest(pool, 'nieuwe ta')).toEqual(['nieuwe taak: lamp vervangen', 'nieuwe taak voor mij: ramen lappen, morgen']);
    expect(plusSuggest(pool, 'Morgen')).toEqual(['nieuwe taak voor mij: ramen lappen, morgen', 'tandarts morgen om 10 uur']);
    expect(plusSuggest(pool, 'zet melk op de boodschappen')).toEqual([]);   // typed in full: nothing left to suggest
    expect(plusSuggest(Array.from({ length: 9 }, (_, i) => `zet ${i}`), 'zet')).toHaveLength(5);
  });
});

describe('the person\'s own language first', () => {
  const examplesOf = (lang) => new Set(Object.values(GATE_WORDS[lang] ?? {}).flatMap((e) => e?.examples ?? []));
  it('the pool puts the examples of the person\'s language before the other\'s (both stay: the "+" reads both)', () => {
    for (const lang of ['en', 'nl']) {
      const own = examplesOf(lang);
      const pool = plusSuggestionPool({ circles: [], lang });
      const firstOther = pool.findIndex((ex) => !own.has(ex));
      const lastOwn = pool.map((ex) => own.has(ex)).lastIndexOf(true);
      expect(lastOwn, `${lang}: an own-language example after another language's`).toBeLessThan(firstOther === -1 ? Infinity : firstOther);
      expect(pool.length).toBe(plusSuggestionPool({ circles: [] }).length);
    }
  });

  it('both shells hand the person\'s language to the pool', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../web/v2/circleApp.js')).toMatch(/plusSuggestionPool\(\{ circles, lang: currentLang\(\) \}\)/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js')).toMatch(/plusSuggestionPool\(\{ circles: list, lang: lang\(\) \}\)/);
  });
});
