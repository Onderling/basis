// @reads-source: both shells are checked as text for the shared rules, so rung 1 runs it (docs/conventions/verification-ladder.md).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ASSISTANT_TABS, assistantTabFor, assistantSectionsOf, assistantAsksSelf, assistantLineAfterRead } from '../../src/v2/assistantTabs.js';
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

describe('"As whom?" is asked above the tabs, on either tab (the phone walk: Gesprek stayed empty with two personas)', () => {
  it('asks when more than one self is ticked and none is chosen', () => {
    const two = [{ id: 'default' }, { id: 'werk' }];
    expect(assistantAsksSelf({ selves: two, asSelf: null })).toBe(true);
    expect(assistantAsksSelf({ selves: two, asSelf: 'werk' })).toBe(false);
    expect(assistantAsksSelf({ selves: [{ id: 'default' }], asSelf: null })).toBe(false);
    expect(assistantAsksSelf({})).toBe(false);
  });

  it('both shells take the question from the one rule and paint it outside the tab sections', () => {
    const web = readFileSync(new URL('../../web/v2/vandaagPlus.js', import.meta.url), 'utf8');
    const phone = readFileSync(new URL('../../../basis-mobile/src/screens/v2/VandaagPlusModal.js', import.meta.url), 'utf8');
    for (const [name, src] of [['web', web], ['phone', phone]]) {
      expect(src, `${name} calls the shared rule`).toMatch(/assistantAsksSelf\(/);
      expect(src, `${name} keeps no copy of the rule`).not.toMatch(/selves\.length > 1/);
    }
    // on the phone the question has its own testID outside the sections, not inside plus-own (shown on Maken only)
    expect(phone).toMatch(/testID="vandaag-plus-ask-self"/);
  });
});

describe('the line after an answer (the phone walk: the question stayed in the line after the answer)', () => {
  it('empties when the thread holds the answer: a done line or a circle card', () => {
    expect(assistantLineAfterRead('wat staat er vandaag', { done: 'Niets vandaag.' })).toBe('');
    expect(assistantLineAfterRead('zet melk op de lijst', { card: { to: [{ circleId: 'c1' }] } })).toBe('');
  });
  it('stays when a form opened from it (the form shows what was said) or the read failed (to fix it)', () => {
    expect(assistantLineAfterRead('notitie: melk', { actId: 'household.note' })).toBe('notitie: melk');
    expect(assistantLineAfterRead('iets', { error: 'nope' })).toBe('iets');
    expect(assistantLineAfterRead('iets', null)).toBe('iets');
  });
  it('the phone takes it from here', () => {
    const phone = readFileSync(new URL('../../../basis-mobile/src/screens/v2/VandaagPlusModal.js', import.meta.url), 'utf8');
    expect(phone).toMatch(/assistantLineAfterRead\(/);
  });
});
