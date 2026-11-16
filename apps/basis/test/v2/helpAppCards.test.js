/**
 * The app's own how-to cards (appCards.js) answer a newcomer's first questions, beside the site deck (kaartjes.js, a
 * copy of the onderling.org cards about Onderling): one matcher reads both, and a card id lives in exactly one of them.
 */
import { describe, it, expect } from 'vitest';
import { answerHelp } from '../../src/v2/help/helpAnswer.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';
import { APP_HOWTO_CARDS } from '../../src/v2/help/appCards.js';
import { plusLineOutcome } from '../../src/v2/vandaagPlus.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';

describe('the app\'s how-to cards', () => {
  it('no card id is in both decks (the site copy stays the site\'s)', () => {
    const site = new Set(helpDeck.kaartjes.map((k) => k.id));
    expect(APP_HOWTO_CARDS.filter((k) => site.has(k.id)).map((k) => k.id)).toEqual([]);
    expect(new Set(APP_HOWTO_CARDS.map((k) => k.id)).size).toBe(APP_HOWTO_CARDS.length);
  });
  it('every card speaks both languages', () => {
    for (const k of APP_HOWTO_CARDS) for (const l of ['nl', 'en']) {
      expect(k[l], `${k.id} ${l}`).toBeTruthy();
      expect(k.kop[l], `${k.id} kop ${l}`).toBeTruthy();
      expect(k.tags[l]?.length, `${k.id} tags ${l}`).toBeGreaterThan(0);
    }
  });
  it('a newcomer\'s first questions are answered, in either language', () => {
    const cases = [
      ['hoe nodig ik iemand uit', 'app.uitnodigen', 'nl'], ['How do I invite someone?', 'app.uitnodigen', 'en'],
      ['hoe maak ik een lijst', 'app.lijst', 'nl'], ['how do I make a list', 'app.lijst', 'en'],
    ];
    for (const [q, id, lang] of cases) expect(answerHelp(q, { lang })?.source?.cardId, q).toBe(id);
  });
  it('every "+" line a card quotes is in that language\'s text AND read by the "+" (a card never teaches a dead line)', () => {
    const byOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
    for (const k of APP_HOWTO_CARDS) {
      for (const [lang, lines] of Object.entries(k.plusLines ?? {})) {
        // a circle named like the card's examples, holding the list the card adds to
        const circleName = lang === 'nl' ? 'Thuis' : 'Home';
        const listName = lang === 'nl' ? 'Boodschappen' : 'Shopping';
        const circles = [{ id: 'c1', name: circleName, lists: [{ name: listName, kind: 'list' }], manifestsByOrigin: { lists: byOrigin.lists, tasks: byOrigin.tasks } }];
        for (const line of lines) {
          expect(k[lang], `${k.id} ${lang} quotes "${line}"`).toContain(`"${line}"`);
          const o = plusLineOutcome(line, { circles, own: { lists: [] } });
          expect(o?.command?.opId ?? o?.actId ?? null, `${k.id} ${lang}: "${line}" is read`).toBeTruthy();
        }
      }
    }
  });
  it('the "+" answers them in its thread (a how-to line is looked up in the cards)', () => {
    const o = plusLineOutcome('hoe nodig ik iemand uit', { circles: [], lang: 'nl' });
    expect(o).toMatchObject({ kind: 'help', card: { cardId: 'app.uitnodigen' } });
  });
});
