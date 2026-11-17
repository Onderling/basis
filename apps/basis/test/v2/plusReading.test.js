/**
 * THE "+" READS WHAT A PERSON SAYS (the UI quirks, item 18, Frits's answers 2026-11-17): help names the lists too, and
 * each list line it quotes is one the "+" reads; a reminder's title is the thing, not the command words; "melk is
 * gedaan" and "melk gedaan" tick the entry, while a question that ends the same way ticks nothing.
 */
import { describe, it, expect } from 'vitest';
import { plusLineOutcome, plusHelpAnswer } from '../../src/v2/vandaagPlus.js';
import { sharedCircleLocale } from '../../src/locales/index.js';

const own = { lists: [{ name: 'Boodschappen', kind: 'shopping' }] };
const now = new Date(2026, 10, 17, 9, 0).getTime();

describe('the "+" reading, item 18', () => {
  for (const lang of ['nl', 'en']) {
    it(`${lang}: help names the lists, and every list line it quotes is read by the "+"`, () => {
      const text = sharedCircleLocale[lang].vandaag.plus_help.text;
      const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(quoted.length, 'help quotes list lines').toBeGreaterThanOrEqual(2);
      for (const line of quoted) {
        // the first makes the list; the others read to a list that exists
        const o = plusLineOutcome(line, { circles: [], own: /new list|nieuwe lijst/i.test(line) ? { lists: [] } : { lists: [{ name: lang === 'nl' ? 'Boodschappen' : 'Shopping' }] }, lang });
        expect(o?.kind, line).toBe('circle');
        expect(o?.atOnce, line).toBe(true);
      }
      const t = (k, v = {}) => (k === 'circle.vandaag.plus_help' ? text.replace('{{acts}}', v.acts) : k);
      expect(plusHelpAnswer({ kind: 'help' }, { t })).toMatch(/Boodschappen|Shopping/);
    });
  }

  it('a reminder\'s title is the thing, not "herinner me aan …" (nl and en)', () => {
    expect(plusLineOutcome('herinner me morgen om 9 uur aan de vuilnis', { circles: [], now })?.values?.title).toBe('de vuilnis');
    expect(plusLineOutcome('remind me tomorrow at 9 about the bins', { circles: [], now })?.values?.title).toBe('the bins');
  });

  it('"melk is gedaan" and "melk gedaan" tick melk on the own lists; a question that ends the same way does not', () => {
    for (const line of ['melk is gedaan', 'melk gedaan']) {
      expect(plusLineOutcome(line, { circles: [], own })?.command, line).toMatchObject({ opId: 'markListItemDone', args: { item: 'melk' } });
    }
    for (const line of ['wat is er gedaan', 'wat heb ik gedaan']) {
      expect(plusLineOutcome(line, { circles: [], own })?.command?.opId, line).not.toBe('markListItemDone');
    }
    // the English twin, on an English list
    expect(plusLineOutcome('milk done', { circles: [], own: { lists: [{ name: 'Shopping' }] } })?.command).toMatchObject({ opId: 'markListItemDone', args: { item: 'milk' } });
    for (const line of ['is dinner done?', 'what is done']) {
      expect(plusLineOutcome(line, { circles: [], own: { lists: [{ name: 'Shopping' }] } })?.command?.opId, line).not.toBe('markListItemDone');
    }
    // with no own list there is nothing to tick: the line is not read as one
    expect(plusLineOutcome('melk is gedaan', { circles: [], own: { lists: [] } })?.command?.opId).not.toBe('markListItemDone');
  });
});
