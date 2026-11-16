/**
 * MAKING A CIRCLE ASKS ITS KIND AND ITS PURPOSE (walk rows 14/15/19/33, 2026-11): the short path used to make every
 * circle a Household "Running our home together" without asking — a street became a home, and the joiners read that
 * purpose. Now the first step asks the kind (the templates that exist, and "other"), and shows the purpose as a field
 * the person can change: the kind's sentence as a suggestion, empty for "other". Nothing is chosen silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initialState, identityComplete, chooseKind, CREATE_KIND_CHOICES, purposeOrDefault, withCreateDefaults,
} from '../../../src/core/wizards/createGroupState.js';
import { CIRCLE_TEMPLATES } from '../../../src/v2/circleTemplates.js';
import en from '../../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../../src/locales/circle.nl.json' with { type: 'json' };

const t = (k) => `«${k}»`;
const named = () => ({ ...initialState(), name: 'Straat Test', groupId: 'straat-test' });
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the first step asks the kind', () => {
  it('the choices are the templates that exist, then "other" (no template: the neutral defaults)', () => {
    expect(CREATE_KIND_CHOICES).toEqual(['household', 'neighbourhood', 'friends', 'team', 'other']);
    for (const k of CREATE_KIND_CHOICES) { expect(en.kind[k]).toBeTruthy(); expect(nl.kind[k]).toBeTruthy(); }
  });

  it('a new circle has no kind until the person picks one, and the step cannot be left without it', () => {
    const s = named();
    expect(s.kind).toBeNull();
    expect(identityComplete(s)).toBe(false);
    expect(identityComplete(chooseKind(s, 'neighbourhood', t))).toBe(true);
  });

  it('picking a kind applies its template and puts its sentence in the purpose field, where the person sees it', () => {
    const s = chooseKind(named(), 'neighbourhood', t);
    expect(s.kind).toBe('neighbourhood');
    expect(s.features).toEqual(CIRCLE_TEMPLATES.neighbourhood.features);
    expect(s.purpose).toBe('«circle.wizard.create.default_purpose_neighbourhood»');
  });

  it('another kind replaces an untouched suggestion; what the person typed stays; "other" suggests nothing', () => {
    const a = chooseKind(chooseKind(named(), 'household', t), 'neighbourhood', t);
    expect(a.purpose).toBe('«circle.wizard.create.default_purpose_neighbourhood»');
    const typed = { ...chooseKind(named(), 'household', t), purpose: 'Samen de straat schoonhouden' };
    expect(chooseKind(typed, 'friends', t).purpose).toBe('Samen de straat schoonhouden');
    expect(chooseKind(chooseKind(named(), 'team', t), 'other', t).purpose).toBe('');
    expect(chooseKind(named(), 'other', t).kind).toBe('other');
  });

  it('nothing is filled in silently at the end: the purpose is what the field holds', () => {
    const s = { ...chooseKind(named(), 'other', t), purpose: '' };
    expect(purposeOrDefault(s, t)).toBe('');
    expect(withCreateDefaults(s, t).purpose).toBe('');
  });

  it('both shells ask it on the first step, outside the "Advanced" fold, with the purpose as a field', () => {
    const web = read('../../../src/web/wizards/createGroupWizard.js');
    const step1 = web.slice(web.indexOf('function renderIdentityStep('), web.indexOf("// EVERYTHING ELSE behind one fold"));
    expect(step1).toMatch(/CREATE_KIND_CHOICES/);
    expect(step1).toMatch(/chooseKind\(state, k, t\)/);
    expect(step1).toMatch(/'purpose'/);
    const rn = read('../../../src/rn/wizards/createGroupWizardModal.js');
    const rnStep1 = rn.slice(rn.indexOf('testID="create-group-kind"'), rn.indexOf('testID="create-group-advanced"'));
    expect(rnStep1).toMatch(/CREATE_KIND_CHOICES/);
    expect(rnStep1).toMatch(/chooseKind\(s, k, t\)/);
    expect(rnStep1).toMatch(/testID="create-group-purpose"/);
  });
});

describe('the joiner reads the purpose', () => {
  it('the phone join wizard paints the rules headings in the theme\'s ink, not the platform default (dark on a dark box)', () => {
    const rn = read('../../../src/rn/wizards/joinGroupWizardModal.js');
    expect(rn).toMatch(/rulesQ: \{[^}]*color: c\.ink/);
    expect(rn).toMatch(/<Text style=\{styles\.rulesQ\}>\{label\}<\/Text>/);
  });
});
