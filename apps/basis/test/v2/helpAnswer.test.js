import { describe, it, expect } from 'vitest';
import { answerHelp, answerHelpTopic, helpTopics } from '../../src/v2/help/helpAnswer.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';

// The card text answerHelp returns for a given query+lang, or null on a miss.
function cardText(id, lang) {
  const k = helpDeck.kaartjes.find((x) => x.id === id);
  return k ? k[lang] : null;
}

// Routing fitness — the same expectations the site guards, ported. `expected`
// is a card id, or 'fallback' (→ null), or 'opening' (→ the greeting text).
const CASES = {
  nl: [
    ['Wat is Onderling?', 'onderling.wat'],
    ['Waarom doen jullie dit?', 'onderling.missie'],
    ['Wie zit hier eigenlijk achter?', 'onderling.wie-erachter'],
    ['Wat is Basis?', 'product.basis'],
    ['Wat is feedback?', 'product.feedback'],
    ['Hoe werkt een kring?', 'werking.kringen'],
    ['Wat kost het?', 'praktisch.kosten'],
    ['Is het gratis?', 'praktisch.kosten'],
    ['Wie ben jij?', 'meta.bot'],
    ['Ben jij een bot?', 'meta.bot'],
    ['Is dit veilig?', 'veilig.kern'],
    ['Kunnen jullie mijn berichten lezen?', 'principe.versleuteld'],
    ['Moet ik een account aanmaken?', 'principe.geenaccount'],
    ['Wat is een herstelzin?', 'principe.geenaccount'],
    ['Werkt het op mijn telefoon?', 'praktisch.apparaten'],
    ['Is er een iPhone-app?', 'praktisch.apparaten'],
    ['Wat is een Solid Pod?', 'principe.zeggenschap'],
    ['Wie is de baas over mijn gegevens?', 'principe.zeggenschap'],
    ['Hoe kan ik bijdragen?', 'doe.bouwmee'],
    ['Waar gaat deze vraag naartoe?', 'veilig.dezevraag'],
    ['Slaan jullie mijn vragen op?', 'veilig.dezevraag'],
    ['Is de broncode openbaar?', 'principe.opensource'],
    ['Kan ik het zelf hosten?', 'principe.opensource'],
    ['Welk taalmodel gebruiken jullie?', 'werking.ai'],
    ['Wat is Privatemode?', 'werking.ai'],
    ['Hoe blijf ik op de hoogte?', 'doe.volgen'],
    ['Hebben jullie een nieuwsbrief?', 'doe.volgen'],
    ['Kan ik taken verdelen?', 'werking.taken'],
    ['Wat zijn hulpjes?', 'werking.hulpjes'],
    ['Hoe kan ik het proberen?', 'doe.probeer'],
    ['Ik zit in een VvE', 'intro.bestuur'],
    ['Iets voor onze straat?', 'intro.buurt'],
    ['Is er een SDK?', 'intro.dev'],
    ['Wat zijn de grenzen van de versleuteling?', 'veilig.grenzen'],
    ['Kan ik iets verwijderen?', 'veilig.grenzen'],
    ['Hoe af is het?', 'praktisch.status'],
    ['Hallo!', 'opening'],
    ['Bakken jullie ook pizza?', 'fallback'],
    ['asdfghjkl', 'fallback'],
  ],
  en: [
    ['What is Onderling?', 'onderling.wat'],
    ['What is Basis?', 'product.basis'],
    ['How do circles work?', 'werking.kringen'],
    ['What does it cost?', 'praktisch.kosten'],
    ['Is it free?', 'praktisch.kosten'],
    ['Who are you?', 'meta.bot'],
    ['Are you a bot?', 'meta.bot'],
    ['Is this safe?', 'veilig.kern'],
    ['Can you read my messages?', 'principe.versleuteld'],
    ['Do I need an account?', 'principe.geenaccount'],
    ['What is a recovery phrase?', 'principe.geenaccount'],
    ['Does it work on my phone?', 'praktisch.apparaten'],
    ['Is there an iPhone app?', 'praktisch.apparaten'],
    ['What is a Solid Pod?', 'principe.zeggenschap'],
    ['How can I contribute?', 'doe.bouwmee'],
    ['Where does this question go?', 'veilig.dezevraag'],
    ['Is the source code public?', 'principe.opensource'],
    ['Can I host it myself?', 'principe.opensource'],
    ['Which language model do you use?', 'werking.ai'],
    ['How do I stay updated?', 'doe.volgen'],
    ['What are helpers?', 'werking.hulpjes'],
    ['How can I try it?', 'doe.probeer'],
    ['Anything for our street?', 'intro.buurt'],
    ['Is there an SDK?', 'intro.dev'],
    ['What are the limits of the encryption?', 'veilig.grenzen'],
    ['How finished is it?', 'praktisch.status'],
    ['Hello!', 'opening'],
    ['Do you bake pizza?', 'fallback'],
  ],
};

describe('helpAnswer · routing fitness (site parity)', () => {
  for (const lang of ['nl', 'en']) {
    for (const [q, expected] of CASES[lang]) {
      it(`${lang}: ${JSON.stringify(q)} → ${expected}`, () => {
        const res = answerHelp(q, { lang });
        if (expected === 'fallback') {
          expect(res).toBeNull();
          return;
        }
        expect(res).not.toBeNull();
        if (expected === 'opening') {
          expect(res.text).toBe(helpDeck.opening[lang]);
          expect(res.layer).toBe(0);
          expect(res.source.cardId).toBeNull();
        } else {
          expect(res.source.cardId).toBe(expected);
          expect(res.text).toBe(cardText(expected, lang));
        }
      });
    }
  }
});

describe('helpAnswer · layers', () => {
  it('layer 0 — word rule hit (self-referential question)', () => {
    const nl = answerHelp('Wie ben jij?', { lang: 'nl' });
    expect(nl.layer).toBe(0);
    expect(nl.source.cardId).toBe('meta.bot');
    const en = answerHelp('Who are you?', { lang: 'en' });
    expect(en.layer).toBe(0);
    expect(en.source.cardId).toBe('meta.bot');
  });

  it('layer 0 — greeting resolves to the opening (cardId null)', () => {
    const res = answerHelp('Hallo!', { lang: 'nl' });
    expect(res.layer).toBe(0);
    expect(res.text).toBe(helpDeck.opening.nl);
    expect(res.source.cardId).toBeNull();
  });

  it('layer 1 — tag/heading overlap hit', () => {
    const res = answerHelp('Wat kost het?', { lang: 'nl' });
    expect(res.layer).toBe(1);
    expect(res.source.cardId).toBe('praktisch.kosten');
  });

  it('no match → null (where a consent-gated model fallback would go)', () => {
    expect(answerHelp('Bakken jullie ook pizza?', { lang: 'nl' })).toBeNull();
    expect(answerHelp('Do you bake pizza?', { lang: 'en' })).toBeNull();
    expect(answerHelp('', { lang: 'nl' })).toBeNull();
    expect(answerHelp(null, { lang: 'nl' })).toBeNull();
  });
});

describe('helpAnswer · transparency source label', () => {
  it('a card answer carries kind, label, and card provenance', () => {
    const res = answerHelp('Wat is Basis?', { lang: 'nl' });
    expect(res.source).toEqual({
      kind: 'local',
      label: helpDeck.srcLocal.nl,
      cardId: 'product.basis',
    });
    // the label mirrors the site's "answered directly — no language model" badge.
    expect(res.source.label).toBe('direct beantwoord — geen taalmodel gebruikt');
  });

  it('the EN label is the English provenance string', () => {
    const res = answerHelp('What is Basis?', { lang: 'en' });
    expect(res.source.label).toBe('answered directly — no language model used');
    expect(res.source.kind).toBe('local');
  });
});

describe('helpAnswer · NL ≡ EN parity', () => {
  // Every card MUST have both nl and en text (a missing translation is a
  // failure, exactly as the site build treats it) plus per-language tags.
  it('every card has non-empty nl and en text + tags', () => {
    for (const k of helpDeck.kaartjes) {
      expect(typeof k.nl, `${k.id} nl`).toBe('string');
      expect(k.nl.trim().length, `${k.id} nl`).toBeGreaterThan(0);
      expect(typeof k.en, `${k.id} en`).toBe('string');
      expect(k.en.trim().length, `${k.id} en`).toBeGreaterThan(0);
      expect(Array.isArray(k.tags.nl), `${k.id} tags.nl`).toBe(true);
      expect(Array.isArray(k.tags.en), `${k.id} tags.en`).toBe(true);
      expect(typeof k.kop.nl, `${k.id} kop.nl`).toBe('string');
      expect(typeof k.kop.en, `${k.id} kop.en`).toBe('string');
    }
  });

  // The same question, asked in either language, resolves to the same card.
  const PAIRS = [
    ['Wat is Onderling?', 'What is Onderling?', 'onderling.wat'],
    ['Wat is Basis?', 'What is Basis?', 'product.basis'],
    ['Hoe werkt een kring?', 'How do circles work?', 'werking.kringen'],
    ['Wat kost het?', 'What does it cost?', 'praktisch.kosten'],
    ['Wie ben jij?', 'Who are you?', 'meta.bot'],
    ['Is dit veilig?', 'Is this safe?', 'veilig.kern'],
    ['Moet ik een account aanmaken?', 'Do I need an account?', 'principe.geenaccount'],
    ['Wat is een Solid Pod?', 'What is a Solid Pod?', 'principe.zeggenschap'],
    ['Is de broncode openbaar?', 'Is the source code public?', 'principe.opensource'],
    ['Welk taalmodel gebruiken jullie?', 'Which language model do you use?', 'werking.ai'],
    ['Waar gaat deze vraag naartoe?', 'Where does this question go?', 'veilig.dezevraag'],
    ['Hallo!', 'Hello!', 'opening'],
  ];
  for (const [nlq, enq, expected] of PAIRS) {
    it(`${expected}: NL and EN resolve the same card`, () => {
      const nl = answerHelp(nlq, { lang: 'nl' });
      const en = answerHelp(enq, { lang: 'en' });
      expect(nl).not.toBeNull();
      expect(en).not.toBeNull();
      if (expected === 'opening') {
        expect(nl.source.cardId).toBeNull();
        expect(en.source.cardId).toBeNull();
      } else {
        expect(nl.source.cardId).toBe(expected);
        expect(en.source.cardId).toBe(expected);
      }
      // and the two are genuinely different localizations, not the same string.
      expect(nl.text).not.toBe(en.text);
    });
  }
});

describe('helpAnswer · answerHelpTopic (direct topic resolution)', () => {
  it('resolves a topic id straight to its localized card + source (no query matching)', () => {
    const nl = answerHelpTopic('product.basis', { lang: 'nl' });
    expect(nl.text).toBe(cardText('product.basis', 'nl'));
    expect(nl.source).toEqual({ kind: 'local', label: helpDeck.srcLocal.nl, cardId: 'product.basis' });
    const en = answerHelpTopic('product.basis', { lang: 'en' });
    expect(en.text).toBe(cardText('product.basis', 'en'));
  });

  it('returns null for the fallback card and unknown ids', () => {
    expect(answerHelpTopic(helpDeck.fallbackId, { lang: 'nl' })).toBeNull();
    expect(answerHelpTopic('no.such.card', { lang: 'nl' })).toBeNull();
  });
});

describe('helpAnswer · helpTopics', () => {
  it('lists the answerable headings, excluding the fallback card', () => {
    const nl = helpTopics({ lang: 'nl' });
    expect(nl.length).toBe(helpDeck.kaartjes.length - 1);
    expect(nl.every((t) => typeof t.id === 'string' && typeof t.kop === 'string')).toBe(true);
    expect(nl.some((t) => t.id === helpDeck.fallbackId)).toBe(false);
    expect(nl.find((t) => t.id === 'product.basis').kop).toBe('Basis');
  });

  it('localizes the headings', () => {
    const nl = helpTopics({ lang: 'nl' });
    const en = helpTopics({ lang: 'en' });
    const nlWat = nl.find((t) => t.id === 'onderling.wat');
    const enWat = en.find((t) => t.id === 'onderling.wat');
    expect(nlWat.kop).toBe('Wat is Onderling?');
    expect(enWat.kop).toBe('What is Onderling?');
  });
});
