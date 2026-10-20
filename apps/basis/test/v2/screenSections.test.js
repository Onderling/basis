/**
 * A hand-painted screen's sections are declared once and painted by BOTH shells from the list, by id.
 */
import { describe, it, expect } from 'vitest';
import { sectionsOf, SCREEN_SECTIONS } from '../../src/v2/screenSections.js';
import circleNl from '../../src/locales/circle.nl.json' with { type: 'json' };

const has = (bundle, key) => key.split('.').slice(bundle.circle ? 0 : 1).reduce((o, k) => o?.[k], bundle)?.text !== undefined;

describe('screenSections', () => {
  it('the admin panel: members · announce · outbound shares · muted, each titled by a key that exists', () => {
    expect(sectionsOf('adminPanel').map((s) => s.id)).toEqual(['admin-members', 'admin-announce', 'admin-outbound-shares', 'admin-muted']);
    for (const s of sectionsOf('adminPanel')) expect(has(circleNl, s.titleKey), s.titleKey).toBe(true);
  });
  it('the member card: how much it reveals · what this viewer sees · what stays hidden, titled by keys that exist', () => {
    expect(sectionsOf('memberCard').map((s) => s.id)).toEqual(['membercard-preset', 'membercard-sees', 'membercard-hides']);
    for (const s of sectionsOf('memberCard')) expect(has(circleNl, s.titleKey), s.titleKey).toBe(true);
  });
  it('a screen not declared has no sections; the declaration is frozen', () => {
    expect(sectionsOf('nope')).toEqual([]);
    expect(Object.isFrozen(SCREEN_SECTIONS.adminPanel)).toBe(true);
  });
});
