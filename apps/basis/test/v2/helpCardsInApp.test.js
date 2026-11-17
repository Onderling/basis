import { describe, it, expect } from 'vitest';
import { helpDeck as siteDeck } from '../../src/v2/help/kaartjes.js';
import { APP_VARIANTS } from '../../src/v2/help/appCards.js';
import { helpCardsDeck, INTRO_HELP_CARDS } from '../../src/v2/help/helpCards.js';
import { INTRO_CARDS } from '../../src/v2/introDeck.js';
import { sharedCircleLocale } from '../../src/locales/index.js';

// THE HELP CARDS AS THE APP SHOWS THEM (the help-card audit, 2026-11-17): a site card read inside the app must not speak
// of the website, must say "kring" in Dutch, and must name the backup file wherever it offers a pod for a backup.
const inApp = helpCardsDeck.kaartjes;

describe('the help cards as the app shows them', () => {
  it('every app variant is the app\'s text for a card the site deck has (never a new card by the back door)', () => {
    const siteIds = new Set(siteDeck.kaartjes.map((k) => k.id));
    for (const id of Object.keys(APP_VARIANTS)) {
      expect(siteIds.has(id), id).toBe(true);
      const card = inApp.find((k) => k.id === id);
      expect(card.nl).toBe(APP_VARIANTS[id].nl);
      expect(card.en).toBe(APP_VARIANTS[id].en);
      // the matcher finds the same card: its tags and heading stay the site's
      expect(card.tags).toEqual(siteDeck.kaartjes.find((k) => k.id === id).tags);
    }
  });

  it('no Dutch card in the app says "circle": the app says "kring"', () => {
    for (const k of inApp) expect(String(k.nl), k.id).not.toMatch(/\bcircles?\b|circlegenoten/i);
  });

  it('no card in the app speaks of "this website" or "this page" (the reader is in the app)', () => {
    for (const k of inApp) {
      expect(String(k.nl), k.id).not.toMatch(/deze website|deze pagina/i);
      expect(String(k.en), k.id).not.toMatch(/this website|this page/i);
    }
  });

  it('a card that offers a pod for a backup also names the backup file (Frits keeps both named)', () => {
    for (const k of inApp) {
      if (/Solid Pod/i.test(k.nl) && /reservekopie|back-up/i.test(k.nl)) expect(k.nl, k.id).toMatch(/back-upbestand/);
      if (/Solid Pod/i.test(k.en) && /backup/i.test(k.en)) expect(k.en, k.id).toMatch(/backup file/);
    }
  });

  it('the introduction\'s seven cards are help cards too, with the intro\'s own words (one source)', () => {
    expect(INTRO_HELP_CARDS.map((k) => k.id)).toEqual(INTRO_CARDS.map((id) => `app.intro.${id}`));
    for (const lang of ['nl', 'en']) {
      const tree = sharedCircleLocale[lang];
      for (const id of INTRO_CARDS) {
        const card = inApp.find((k) => k.id === `app.intro.${id}`);
        expect(card[lang]).toBe(tree.introDeck[`${id}_body`].text);
        expect(card.kop[lang]).toBe(tree.introDeck[`${id}_title`].text);
        expect(card.tags[lang].length, `${id} ${lang} tags`).toBeGreaterThan(0);
      }
    }
  });
});
