/**
 * Every canonical item type is shown in a cross-circle view by a presenter, or is named with its reason: messages are
 * the log's projection (their entry is the render), and the rest wait in `NOT_YET`, which only shrinks — a noun that
 * gains a presenter must leave it in the same change.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL_TYPES } from '@onderling/item-types';
import { ITEM_PRESENTERS, LOG_PROJECTED, NOT_YET } from '../../src/v2/itemPresenters.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };
import en from '../../src/locales/circle.en.json' with { type: 'json' };

describe('every canonical noun has a presenter, or a reason', () => {
  const nouns = Object.keys(CANONICAL_TYPES);
  it('none unaccounted for', () => {
    const missing = nouns.filter((n) => !ITEM_PRESENTERS[n] && !LOG_PROJECTED[n] && !NOT_YET.includes(n));
    expect(missing).toEqual([]);
  });
  it('NOT_YET only shrinks: nothing in it has a presenter, nothing in it is unknown', () => {
    expect(NOT_YET.filter((n) => ITEM_PRESENTERS[n])).toEqual([]);
    expect(NOT_YET.filter((n) => !nouns.includes(n))).toEqual([]);
    expect(NOT_YET.length).toBeLessThanOrEqual(10);   // lower this as presenters land; never raise it
  });
  it('each presenter has the four parts', () => {
    for (const [n, p] of Object.entries(ITEM_PRESENTERS)) {
      expect(typeof p.label, n).toBe('function');
      expect(typeof p.when, n).toBe('function');
      expect(typeof p.isMine, n).toBe('function');
      expect(['asc', 'desc'], n).toContain(p.order);
    }
  });
  it('each presented noun has a title in both languages (the items block\'s heading)', () => {
    for (const n of Object.keys(ITEM_PRESENTERS)) {
      expect(nl.screen.items_title[n], `nl ${n}`).toBeTruthy();
      expect(en.screen.items_title[n], `en ${n}`).toBeTruthy();
    }
  });
});
