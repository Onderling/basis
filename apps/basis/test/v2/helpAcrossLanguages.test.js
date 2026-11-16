import { describe, it, expect } from 'vitest';
import { answerHelp, likelyHelpTopics } from '../../src/v2/help/helpAnswer.js';
import { helpTopicChips, parseHelpAction, HELP_ALL_ACTION } from '../../src/v2/helpChat.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';

// Walk row 81: Help, asked "hoe maak ik een kring?" and "is dit veilig?" in an app set to English, answered each time
// with ~30 English topic buttons. The matcher knew both questions, in Dutch: it only looked in the app's language. A
// person writes in either language; the answer is in the app's.
describe('Help reads a question in any language it has, and answers in the app\'s', () => {
  it('a Dutch question in an English app finds its card, answered in English', () => {
    const a = answerHelp('hoe maak ik een kring?', { lang: 'en' });
    expect(a?.source?.cardId).toBe('werking.kringen');
    expect(a.text).toBe(helpDeck.kaartjes.find((k) => k.id === 'werking.kringen').en);
    expect(answerHelp('is dit veilig?', { lang: 'en' })?.source?.cardId).toBe('veilig.kern');
  });

  it('and an English question in a Dutch app, answered in Dutch', () => {
    const a = answerHelp('how do I make a circle?', { lang: 'nl' });
    expect(a?.source?.cardId).toBe('werking.kringen');
    expect(a.text).toBe(helpDeck.kaartjes.find((k) => k.id === 'werking.kringen').nl);
  });

  it('nonsense still finds nothing (the honest miss stays)', () => {
    expect(answerHelp('blauwe olifanten dansen', { lang: 'en' })).toBeNull();
  });
});

describe('a miss offers the five likeliest topics, the rest behind "all topics"', () => {
  it('the likeliest topics are scored in every language, at most five, in the app\'s words', () => {
    const likely = likelyHelpTopics('kring uitnodigen telefoon', { lang: 'en' });
    expect(likely.length).toBeGreaterThan(0);
    expect(likely.length).toBeLessThanOrEqual(5);
    const kops = new Set(helpDeck.kaartjes.map((k) => k.kop.en));
    for (const x of likely) expect(kops.has(x.kop), x.kop).toBe(true);
  });

  it('chips for a question: the likely ones, then one "all topics" chip; a tap on it is its own action', () => {
    const chips = helpTopicChips({ lang: 'nl', query: 'kring uitnodigen telefoon', allLabel: 'Alle onderwerpen' });
    const last = chips[chips.length - 1];
    expect(last).toEqual({ label: 'Alle onderwerpen', action: HELP_ALL_ACTION });
    expect(chips.length).toBeLessThanOrEqual(6);
    expect(parseHelpAction(HELP_ALL_ACTION)).toEqual({ kind: 'all' });
  });

  it('a question that shares nothing, or no question: every topic, as before', () => {
    const all = helpTopicChips({ lang: 'nl' });
    expect(all.length).toBe(helpDeck.kaartjes.filter((k) => k.id !== helpDeck.fallbackId).length);
    expect(helpTopicChips({ lang: 'nl', query: 'qqq zzz', allLabel: 'Alle onderwerpen' })).toEqual(all);
  });
});
