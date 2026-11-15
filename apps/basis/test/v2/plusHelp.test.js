/**
 * HELP INSIDE THE "+" THREAD. The "+" is the person's assistant thread; "help" there must answer, as the box's household
 * bot does: what the "+" can do (its own acts, by name), and a how-to question the help cards know is answered from the
 * card. Before: "help", "hulp" or a how-to question read as nothing and the thread said "I could not read that"; and the
 * help matcher alone answers "help" with the WRONG card (the one about the source code), so the help words are read
 * first, the cards only after the own and circle readings missed (and before the model).
 */
import { describe, it, expect } from 'vitest';
import { plusLineOutcome, plusHelpAnswer, PLUS_ACTS, plusLabel } from '../../src/v2/vandaagPlus.js';
import { plusAnswerLine } from '../../src/v2/plusThread.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };

const t = (k, vars = {}) => {
  const node = k.split('.').slice(1).reduce((o, p) => o?.[p], en);
  const text = typeof node === 'string' ? node : node?.text ?? k;
  return text.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ''));
};

describe('help inside the "+" thread', () => {
  for (const line of ['help', 'hulp', '?', 'Help!', 'help?', 'wat kan je', 'what can you do']) {
    it(`"${line}" says what the "+" can do, by its acts' names`, () => {
      const o = plusLineOutcome(line, { circles: [], lang: 'en' });
      expect(o?.kind).toBe('help');
      const said = plusHelpAnswer(o, { t });
      for (const act of PLUS_ACTS) expect(said).toContain(plusLabel(t, act));
      expect(said).not.toMatch(/github/i);   // never the source-code card
    });
  }

  it('a how-to question the cards know is answered from the card, in the thread', () => {
    const o = plusLineOutcome('wat is een kring', { circles: [], lang: 'en' });
    expect(o?.kind).toBe('help');
    expect(o.card?.cardId).toBe('werking.kringen');
    expect(plusHelpAnswer(o, { t }).length).toBeGreaterThan(20);
  });

  it('a line that is an own act stays that act (help never takes it)', () => {
    expect(plusLineOutcome('notitie: melk halen', { circles: [], lang: 'nl' })?.kind).toBe('own');
  });

  it('an ordinary line that only shares a word with a help card is NOT help (only a line that asks "how/what is/why" is looked up)', () => {
    // "vraag: wie heeft een boor?" hits the noticeboard card on a keyword; it is a question to POST, not about the app
    expect(plusLineOutcome('vraag: wie heeft een boor?', { circles: [], lang: 'nl' })).toBeNull();
  });

  it('a line nothing reads stays unread (the model may still read it)', () => {
    expect(plusLineOutcome('blabla', { circles: [], lang: 'nl' })).toBeNull();
  });

  it('the thread keeps what help answered', () => {
    const o = plusLineOutcome('help', { circles: [], lang: 'en' });
    expect(plusAnswerLine({ done: plusHelpAnswer(o, { t }), t })).toBe(plusHelpAnswer(o, { t }));
  });
});
