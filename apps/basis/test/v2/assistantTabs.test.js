import { describe, it, expect } from 'vitest';
import { ASSISTANT_TABS, assistantTabFor, assistantSectionsOf } from '../../src/v2/assistantTabs.js';
import { sectionsOf } from '../../src/v2/screenSections.js';

describe('the assistant panel: two tabs over the "+" sheet\'s declared sections', () => {
  it('Gesprek first, then Maken, each with its words', () => {
    expect(ASSISTANT_TABS.map((x) => x.id)).toEqual(['gesprek', 'maken']);
    for (const tab of ASSISTANT_TABS) expect(tab.labelKey).toMatch(/^circle\.assistant\./);
  });

  it('every declared section sits in exactly one tab (the two lists agree)', () => {
    const declared = sectionsOf('plusSheet').map((d) => d.id).sort();
    const inTabs = ASSISTANT_TABS.flatMap((x) => x.sections).sort();
    expect(inTabs).toEqual(declared);
  });

  it('the conversation is Gesprek; the pinned and own acts are Maken', () => {
    expect(assistantSectionsOf('gesprek')).toEqual(['plus-thread', 'plus-line']);
    expect(assistantSectionsOf('maken')).toEqual(['plus-pinned', 'plus-own']);
  });

  it('shows the tab last chosen, Gesprek the first time or for an unknown value', () => {
    expect(assistantTabFor({})).toBe('gesprek');
    expect(assistantTabFor({ chosen: 'maken' })).toBe('maken');
    expect(assistantTabFor({ chosen: 'iets' })).toBe('gesprek');
  });

  it('an open form shows on Maken, where it is painted: from a line, a pick, or an own row', () => {
    expect(assistantTabFor({ chosen: 'gesprek', actId: 'note' })).toBe('maken');
    expect(assistantTabFor({ chosen: 'gesprek', editing: true })).toBe('maken');
  });

  it('when the form closes, the chosen tab shows again', () => {
    expect(assistantTabFor({ chosen: 'gesprek', actId: null })).toBe('gesprek');
  });
});
