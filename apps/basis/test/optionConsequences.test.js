/**
 * N2 — per-option consequence registry tests.
 *
 * The pure mapping from (group, optionId) → locale key that drives the
 * ⓘ "Gevolgen als je dit kiest…" affordance on radio options (web
 * `appendRadioField`, mobile `_kit.RadioGroup`).
 */
import { describe, it, expect } from 'vitest';

import {
  CONSEQUENCE_OPTIONS, hasConsequence, consequenceKeyFor, attachConsequences,
} from '../src/v2/optionConsequences.js';
import enRaw from '../locales/en.json' assert { type: 'json' };
import nlRaw from '../locales/nl.json' assert { type: 'json' };
import { sharedConsequenceLocale } from '../src/locales/index.js';
// `consequence.*` now lives in the shared source (like `circle.*`); merge it back to check the effective bundle.
const en = { ...enRaw, consequence: sharedConsequenceLocale.en };
const nl = { ...nlRaw, consequence: sharedConsequenceLocale.nl };

describe('hasConsequence', () => {
  it('is true for registered (group, option) pairs', () => {
    expect(hasConsequence('accessPolicy', 'open')).toBe(true);
    expect(hasConsequence('kind', 'neighbourhood')).toBe(true);
    expect(hasConsequence('size', 'large')).toBe(true);
  });
  it('is false for unknown groups / options', () => {
    expect(hasConsequence('accessPolicy', 'nope')).toBe(false);
    expect(hasConsequence('unknownGroup', 'open')).toBe(false);
    expect(hasConsequence(undefined, undefined)).toBe(false);
  });
});

describe('consequenceKeyFor', () => {
  it('derives consequence.<group>.<option> for registered options', () => {
    expect(consequenceKeyFor('storagePolicy', 'no-pod')).toBe('consequence.storagePolicy.no-pod');
    expect(consequenceKeyFor('conflictPolicy', 'vote')).toBe('consequence.conflictPolicy.vote');
  });
  it('returns null for unregistered options', () => {
    expect(consequenceKeyFor('storagePolicy', 'mystery')).toBeNull();
  });
});

describe('attachConsequences (mobile option enrichment)', () => {
  const t = (k) => `T(${k})`;

  it('adds a localised consequence string to registered options only', () => {
    const out = attachConsequences('accessPolicy', [
      { id: 'invite-only', label: 'A' },
      { id: 'open',        label: 'B' },
      { id: 'mystery',     label: 'C' },   // not registered → untouched
    ], t);
    expect(out[0].consequence).toBe('T(consequence.accessPolicy.invite-only)');
    expect(out[1].consequence).toBe('T(consequence.accessPolicy.open)');
    expect(out[2].consequence).toBeUndefined();
  });

  it('is a no-op without a t function or options array', () => {
    expect(attachConsequences('kind', [{ id: 'neighbourhood', label: 'x' }], null))
      .toEqual([{ id: 'neighbourhood', label: 'x' }]);
    expect(attachConsequences('kind', null, t)).toEqual([]);
  });
});

describe('registry shape', () => {
  it('every registered group maps to a non-empty option list', () => {
    for (const [group, opts] of Object.entries(CONSEQUENCE_OPTIONS)) {
      expect(Array.isArray(opts), group).toBe(true);
      expect(opts.length, group).toBeGreaterThan(0);
    }
  });

  it('every registered option has en + nl consequence text (no drift)', () => {
    for (const [group, opts] of Object.entries(CONSEQUENCE_OPTIONS)) {
      for (const opt of opts) {
        expect(en.consequence?.[group]?.[opt]?.text, `en ${group}.${opt}`).toBeTruthy();
        expect(nl.consequence?.[group]?.[opt]?.text, `nl ${group}.${opt}`).toBeTruthy();
      }
    }
  });
});
