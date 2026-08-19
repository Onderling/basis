import { describe, it, expect } from 'vitest';
import {
  routeHelpMessage, helpTopicChips, resolveHelpTopic,
  parseHelpAction, helpTopicAction, helpConsentAction, helpLlmLabelKeys,
} from '../../src/v2/helpChat.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';
import nl from '../../src/locales/circle.nl.json';
import en from '../../src/locales/circle.en.json';

describe('helpChat · routeHelpMessage', () => {
  it('HIT (deterministic kaartje) → the card text + on-device provenance', () => {
    const r = routeHelpMessage('Wat is Basis?', { lang: 'nl', llmReady: true });
    expect(r.kind).toBe('hit');
    const card = helpDeck.kaartjes.find((k) => k.id === 'product.basis');
    expect(r.text).toBe(card.nl);
    // llmUsed:false is what lights the "answered directly — no language model" badge.
    expect(r.provenance.llmUsed).toBe(false);
    expect(r.provenance.source.cardId).toBe('product.basis');
    expect(r.provenance.source.kind).toBe('local');
  });

  it('a HIT never offers the LLM, even when one is connected', () => {
    expect(routeHelpMessage('Hoe werkt een kring?', { lang: 'nl', llmReady: true }).kind).toBe('hit');
  });

  it('MISS + an LLM connected → offer the consent card', () => {
    expect(routeHelpMessage('Bakken jullie ook pizza?', { lang: 'nl', llmReady: true })).toEqual({ kind: 'consent' });
  });

  it('MISS + NO LLM → the honest set-topics fallback', () => {
    expect(routeHelpMessage('Bakken jullie ook pizza?', { lang: 'nl', llmReady: false })).toEqual({ kind: 'topics' });
    expect(routeHelpMessage('Do you bake pizza?', { lang: 'en', llmReady: false })).toEqual({ kind: 'topics' });
  });
});

describe('helpChat · topics as chips / slash', () => {
  it('helpTopicChips lists every answerable heading with a help:topic action', () => {
    const chips = helpTopicChips({ lang: 'nl' });
    expect(chips.length).toBe(helpDeck.kaartjes.length - 1);   // excludes the fallback card
    const basis = chips.find((c) => c.action === helpTopicAction('product.basis'));
    expect(basis.label).toBe('Basis');
    expect(chips.every((c) => c.action.startsWith('help:topic:'))).toBe(true);
  });

  it('resolveHelpTopic resolves a topic id deterministically to its card', () => {
    const r = resolveHelpTopic('product.basis', { lang: 'en' });
    const card = helpDeck.kaartjes.find((k) => k.id === 'product.basis');
    expect(r.text).toBe(card.en);
    expect(r.provenance.llmUsed).toBe(false);
    expect(r.provenance.source.cardId).toBe('product.basis');
  });

  it('resolveHelpTopic rejects the fallback card + unknown ids', () => {
    expect(resolveHelpTopic(helpDeck.fallbackId, { lang: 'nl' })).toBeNull();
    expect(resolveHelpTopic('no.such.card', { lang: 'nl' })).toBeNull();
  });
});

describe('helpChat · helpLlmLabelKeys (#37 honest route wording)', () => {
  it('a CONFIDENTIAL route → the confidential badge + consent keys', () => {
    expect(helpLlmLabelKeys({ confidential: true })).toEqual({
      badgeKey: 'circle.help.provenance_llm',
      consentKey: 'circle.help.consent_prompt',
    });
  });

  it('a PLAIN route → the plain badge + consent keys (never says "vertrouwelijk")', () => {
    expect(helpLlmLabelKeys({ confidential: false })).toEqual({
      badgeKey: 'circle.help.provenance_llm_plain',
      consentKey: 'circle.help.consent_prompt_plain',
    });
    // default (no arg) is the conservative plain variant.
    expect(helpLlmLabelKeys()).toEqual(helpLlmLabelKeys({ confidential: false }));
  });

  it('every chosen key resolves in BOTH locales, and only the confidential text claims confidentiality', () => {
    const at = (obj, path) => path.split('.').slice(1).reduce((o, k) => o?.[k], obj); // strip leading "circle."
    for (const conf of [true, false]) {
      const { badgeKey, consentKey } = helpLlmLabelKeys({ confidential: conf });
      for (const [locale, claim] of [[nl, 'vertrouwelijke'], [en, 'confidential']]) {
        const badge = at(locale, badgeKey)?.text;
        const consent = at(locale, consentKey)?.text;
        expect(typeof badge).toBe('string');
        expect(typeof consent).toBe('string');
        // The confidential variant NAMES the confidential assistant; the plain one must NOT.
        expect(badge.includes(claim)).toBe(conf);
        expect(consent.includes(claim)).toBe(conf);
      }
    }
  });
});

describe('helpChat · action namespace', () => {
  it('round-trips topic + consent actions', () => {
    expect(parseHelpAction(helpTopicAction('werking.kringen'))).toEqual({ kind: 'topic', id: 'werking.kringen' });
    expect(parseHelpAction(helpConsentAction('yes'))).toEqual({ kind: 'consent', value: 'yes' });
    expect(parseHelpAction(helpConsentAction('no'))).toEqual({ kind: 'consent', value: 'no' });
  });

  it('returns null for non-help actions', () => {
    expect(parseHelpAction('onboarding:ja')).toBeNull();
    expect(parseHelpAction('slash:/done')).toBeNull();
    expect(parseHelpAction('help:')).toBeNull();
    expect(parseHelpAction(null)).toBeNull();
  });
});
