/**
 * The feedback prefill names the KIND of screen, never what is on it: the draft goes to the maker's contact, and a
 * circle's name is the person's own.
 */
import { describe, it, expect } from 'vitest';
import { feedbackScreenId, feedbackDraft } from '../../src/v2/feedbackContact.js';

describe('feedbackScreenId', () => {
  it('inside a circle it says "circle", whatever the circle is called', () => {
    const id = feedbackScreenId({ inCircle: true, screen: 'detail' });
    expect(id).toBe('circle');
    const draft = feedbackDraft({ screen: id, version: '0.1.74' });
    expect(draft).not.toContain('Huize Zwartkruid-7731');
  });

  it('a top-level screen by its id, the same id on web and mobile', () => {
    expect(feedbackScreenId({ screen: 'screens' })).toBe('vandaag');
    expect(feedbackScreenId({ screen: 'circles' })).toBe('kringen');
    expect(feedbackScreenId({ screen: 'list' })).toBe('kringen');
    expect(feedbackScreenId({ screen: 'profile' })).toBe('mij');
    expect(feedbackScreenId({ screen: 'mij' })).toBe('mij');
    expect(feedbackScreenId({ screen: 'contacten' })).toBe('contacten');
    expect(feedbackScreenId({ screen: 'nearby' })).toBe('nearby');
    expect(feedbackScreenId({ screen: 'settingsHome' })).toBe('instellingen');
  });

  it('a settings group by its group id', () => {
    expect(feedbackScreenId({ screen: 'settingsGroup', settingsGroup: 'display' })).toBe('instellingen/display');
  });

  it('anything that is not a plain code id is dropped, never echoed', () => {
    expect(feedbackScreenId({ screen: 'Huize Zwartkruid-7731' })).toBe('');
    expect(feedbackScreenId({ screen: 'settingsGroup', settingsGroup: 'Mijn geheime kring' })).toBe('instellingen');
    expect(feedbackScreenId({})).toBe('');
  });
});
