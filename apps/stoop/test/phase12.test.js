/**
 * Stoop V1 — Phase 12 tests.
 *
 * Skills taxonomy + tag-normalisation dictionary + Layer 1 matcher.
 * All pure functions; no agent / network setup needed.
 */

import { matchProfileDrivers } from '@onderling/agent-registry';
import { describe, it, expect } from 'vitest';
import {
  TAXONOMY,
  normaliseTag,
  categoryFor,
  isKnownCategory,
} from '../src/lib/offeringsMatch.js';

// ── Taxonomy ──────────────────────────────────────────────────────────────

describe('Stoop V1 Phase 12 — taxonomy', () => {
  it('exposes 10 categories with NL+EN labels', () => {
    expect(TAXONOMY.categories).toHaveLength(10);
    for (const c of TAXONOMY.categories) {
      expect(typeof c.id).toBe('string');
      expect(c.label.nl).toBeTruthy();
      expect(c.label.en).toBeTruthy();
    }
  });

  it('isKnownCategory accepts taxonomy ids only', () => {
    expect(isKnownCategory('vervoer')).toBe(true);
    expect(isKnownCategory('klusjes')).toBe(true);
    expect(isKnownCategory('does-not-exist')).toBe(false);
  });
});

// ── Tag normalisation (Dutch + English) ───────────────────────────────────

describe('Stoop V1 Phase 12 — normaliseTag (multilingual)', () => {
  it('normalises Dutch fiets variants → bicycle', () => {
    expect(normaliseTag('fiets').tag).toBe('bicycle');
    expect(normaliseTag('fietsen').tag).toBe('bicycle');
    expect(normaliseTag('FIETS').tag).toBe('bicycle');
  });

  it('normalises English bicycle variants → bicycle', () => {
    expect(normaliseTag('bicycle').tag).toBe('bicycle');
    expect(normaliseTag('bike').tag).toBe('bicycle');
  });

  it('returns null for unknown / non-string input', () => {
    expect(normaliseTag('zhuangzi')).toBeNull();
    expect(normaliseTag('')).toBeNull();
    expect(normaliseTag(null)).toBeNull();
    expect(normaliseTag(123)).toBeNull();
  });

  it('every dictionary entry maps to a known category', () => {
    const ids = new Set(TAXONOMY.categories.map(c => c.id));
    // Walk a handful from the JSON to assert consistency.
    for (const term of ['fiets', 'belasting', 'oppassen', 'koken', 'naaien']) {
      const norm = normaliseTag(term);
      expect(ids.has(norm.category)).toBe(true);
    }
  });
});

// ── categoryFor (full-body suggestion) ────────────────────────────────────

describe('Stoop V1 Phase 12 — categoryFor', () => {
  it('suggests a category from a Dutch post body', () => {
    const r = categoryFor('Iemand handig met fietsen? Achterwiel slingert na een val.');
    expect(r.categoryId).toBe('vervoer');
    expect(r.tags).toContain('bicycle');
  });

  it('suggests a category from an English post body', () => {
    const r = categoryFor('Anyone good with a bicycle? My back wheel is wobbling.');
    expect(r.categoryId).toBe('vervoer');
    expect(r.tags).toContain('bicycle');
  });

  it('mixed-language body still works', () => {
    const r = categoryFor('Help met belasting + tax.');
    expect(r.categoryId).toBe('administratie');
    expect(r.tags).toContain('tax-admin');
  });

  it('returns category=null when no dictionary hits', () => {
    const r = categoryFor('lorem ipsum dolor');
    expect(r.categoryId).toBeNull();
    expect(r.tags).toEqual([]);
  });

  it('picks the most-counted category on a multi-category post', () => {
    // klusjes wins clearly: schilderen + verven + ladder = 3 hits.
    const r = categoryFor('Wie wil helpen met schilderen en verven? Ik heb een ladder.');
    expect(r.categoryId).toBe('klusjes');
    expect(r.tags).toEqual(expect.arrayContaining(['painting', 'ladder']));
  });
});

// ── Layer 1 is the person's own offerings (the driver matcher; the roster's `matchesProfile` retired 2026-10-15) ──
// What a post meets is judged by `matchProfileDrivers` over the drivers of kind 'offering' — the taxonomy category is
// one tag on both sides, so a post that only names its category still meets an offering of that category.
describe('Stoop V1 Phase 12 — cross-language matching (Dutch post → English offering)', () => {
  // an offering as the person's driver: its category and its own tags
  const offering = { fiets: { kind: 'offering', text: 'Fietsen maken', tags: ['bicycle'], categoryId: 'vervoer' } };
  it('a Dutch fietsen post meets an offering of category vervoer', async () => {
    const post = categoryFor('iemand die m\'n fiets kan repareren');
    expect((await matchProfileDrivers({ properties: offering, item: post })).length).toBeGreaterThan(0);
  });

  it('an English bicycle post meets the same offering — the category is language-free', async () => {
    const post = categoryFor('Need help with my bicycle');
    expect((await matchProfileDrivers({ properties: offering, item: post })).length).toBeGreaterThan(0);
  });

  it('a post of another category does not', async () => {
    expect((await matchProfileDrivers({ properties: offering, item: { text: 'x', categoryId: 'tuin' } })).length).toBe(0);
  });
});
