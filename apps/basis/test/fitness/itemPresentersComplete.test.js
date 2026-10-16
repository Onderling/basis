/**
 * Every canonical item type is shown in a cross-circle view by a presenter — its manifest's declared facets, or the
 * fallback table — or is named with its reason: messages are
 * the log's projection (their entry is the render), a removed list is never merged (`NOT_MERGED`), and the rest wait in `NOT_YET`, which only shrinks — a noun that
 * gains a presenter must leave it in the same change.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL_TYPES } from '@onderling/item-types';
import { LOG_PROJECTED, NOT_MERGED, NOT_YET } from '../../src/v2/itemPresenters.js';
import { presenterFor } from '../../src/v2/declaredPresenters.js';
import { sharedLocale } from '../../src/locales/index.js';

describe('every canonical noun has a presenter, or a reason', () => {
  const nouns = Object.keys(CANONICAL_TYPES);
  const presented = nouns.filter((n) => presenterFor(n));
  it('none unaccounted for', () => {
    const missing = nouns.filter((n) => !presenterFor(n) && !LOG_PROJECTED[n] && !NOT_MERGED[n] && !NOT_YET.includes(n));
    expect(missing).toEqual([]);
  });
  it('NOT_YET only shrinks: nothing in it has a presenter, nothing in it is unknown', () => {
    expect(NOT_YET.filter((n) => presenterFor(n))).toEqual([]);
    expect(NOT_YET.filter((n) => !nouns.includes(n))).toEqual([]);
    expect(NOT_YET.length).toBeLessThanOrEqual(10);   // lower this as presenters land; never raise it
  });
  it('each presenter has the four parts', () => {
    for (const n of presented) {
      const p = presenterFor(n);
      expect(typeof p.label, n).toBe('function');
      expect(typeof p.when, n).toBe('function');
      expect(typeof p.isMine, n).toBe('function');
      expect(['asc', 'desc'], n).toContain(p.order);
    }
  });
  it('each presented noun says its name in both languages (the items block\'s heading) — its manifest\'s, or the fallback\'s', () => {
    for (const n of presented) {
      expect(sharedLocale.nl.noun[`${n}_other`]?.text, `nl ${n}`).toBeTruthy();
      expect(sharedLocale.en.noun[`${n}_other`]?.text, `en ${n}`).toBeTruthy();
    }
  });
});
