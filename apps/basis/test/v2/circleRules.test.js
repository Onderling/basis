import { describe, it, expect } from 'vitest';
import {
  RULES_FIELDS, RULES_QUESTIONS, DEFAULT_RULES_DOC,
  normalizeRulesDoc, buildRulesDoc, isRulesComplete, isRulesEmpty,
} from '../../src/v2/circleRules.js';

describe('circleRules model', () => {
  it('has 7 fields, 6 questions, with purpose + agreements required', () => {
    expect(RULES_FIELDS).toHaveLength(7);
    expect(RULES_FIELDS).toContain('responsibility');
    expect(RULES_QUESTIONS).toHaveLength(6);
    expect(RULES_QUESTIONS.find((q) => q.key === 'responsibility')).toBeUndefined(); // folded in
    expect(RULES_QUESTIONS.filter((q) => q.required).map((q) => q.key)).toEqual(['purpose', 'agreements']);
  });

  it('DEFAULT_RULES_DOC is every field blank', () => {
    expect(Object.keys(DEFAULT_RULES_DOC).sort()).toEqual([...RULES_FIELDS].sort());
    expect(Object.values(DEFAULT_RULES_DOC).every((v) => v === '')).toBe(true);
  });

  it('normalizeRulesDoc coerces partials + drops unknown keys + non-strings', () => {
    const d = normalizeRulesDoc({ purpose: 'Garden', bogus: 'x', admins: 42 });
    expect(d.purpose).toBe('Garden');
    expect(d.admins).toBe('');     // non-string → ''
    expect(d.bogus).toBeUndefined();
    expect(Object.keys(d)).toHaveLength(7);
    expect(normalizeRulesDoc(null)).toEqual(DEFAULT_RULES_DOC);
  });

  it('buildRulesDoc assembles a doc from field-keyed answers', () => {
    const doc = buildRulesDoc({ purpose: 'P', agreements: 'A', leaving: 'L' });
    expect(doc).toMatchObject({ purpose: 'P', agreements: 'A', leaving: 'L', admins: '', responsibility: '' });
  });

  it('isRulesComplete requires non-blank purpose + agreements', () => {
    expect(isRulesComplete({ purpose: 'P', agreements: 'A' })).toBe(true);
    expect(isRulesComplete({ purpose: 'P', agreements: '   ' })).toBe(false);
    expect(isRulesComplete({ purpose: 'P' })).toBe(false);
    expect(isRulesComplete({})).toBe(false);
  });

  it('isRulesEmpty is true only when every field is blank', () => {
    expect(isRulesEmpty({})).toBe(true);
    expect(isRulesEmpty({ purpose: '  ' })).toBe(true);
    expect(isRulesEmpty({ leaving: 'x' })).toBe(false);
  });
});
