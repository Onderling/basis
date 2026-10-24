/**
 * The feedback contact: the person writing to Onderling about the app. The prefill names the screen and the build and
 * nothing else; the contact is the build's seeded card (none → no target, said honestly); on a bot door the person
 * gets the card's link to add, nothing is forwarded.
 */
import { describe, it, expect } from 'vitest';
import { feedbackDraft, feedbackTarget, feedbackLink } from '../../src/v2/feedbackContact.js';
import { encodeContactCard } from '../../../pinboard/src/lib/contactCard.js';

describe('feedbackContact', () => {
  it('the prefill is "[<screen> · <version>] " and nothing else', () => {
    expect(feedbackDraft({ screen: 'Instellingen', version: 'v0.1.74-alpha' })).toBe('[Instellingen · v0.1.74-alpha] ');
    expect(feedbackDraft({ screen: '', version: '' })).toBe('[? · dev] ');
  });

  it('the target is the seeded card\'s person; no card or a malformed one → none', async () => {
    expect(feedbackTarget(`onderling-contact://${encodeContactCard({ webid: 'https://id.example/onderling' })}`)).toBe('https://id.example/onderling');
    expect(feedbackTarget(null)).toBeNull();
    expect(feedbackTarget('not a card')).toBeNull();
  });

  it('the link is the card on the app\'s own address; no card or no app url → none', () => {
    expect(feedbackLink({ card: null, appUrl: 'https://onderling.org/basis/' })).toBeNull();
    expect(feedbackLink({ card: 'onderling-contact://abc', appUrl: '' })).toBeNull();
    expect(feedbackLink({ card: 'onderling-contact://abc', appUrl: 'https://onderling.org/basis/' })).toBe('https://onderling.org/basis/#contact=abc');
  });
});
