/**
 * A merged view shows a row the way its noun's manifest DECLARES (`presents`: label · moment · order · mine) — so basis
 * never knows a noun by name, and a bot's own noun shows on Vandaag the moment it declares its facets. The hard-coded
 * table (`ITEM_PRESENTERS`) is only the fallback for a canonical noun no manifest declares yet, and it holds no noun a
 * manifest declares.
 */
import { describe, it, expect } from 'vitest';
import { presenterFor, presenterFromFacets } from '../../src/v2/declaredPresenters.js';
import { ITEM_PRESENTERS } from '../../src/v2/itemPresenters.js';
import { allManifests } from '../../src/v2/manifestSources.js';

describe('presenters from the declaration', () => {
  it('a bot\'s own noun shows from its declared facets alone', () => {
    const manifests = [{ app: 'repairbot', itemTypes: ['repair'], nouns: { repair: { atoms: ['add', 'list'], presents: { label: 'what', moment: 'due', order: 'asc', mine: ['fixer'] } } } }];
    const p = presenterFor('repair', { manifests });
    const row = { what: 'kraan', due: '2026-10-20T10:00:00Z', fixer: 'me' };
    expect(p.label(row)).toBe('kraan');
    expect(p.when(row)).toBe(Date.parse('2026-10-20T10:00:00Z'));
    expect(p.order).toBe('asc');
    expect(p.isMine(row, 'me')).toBe(true);
    expect(p.isMine(row, 'you')).toBe(false);
  });

  it('mine reads a field that is a list, or a list of people', () => {
    const p = presenterFromFacets({ mine: ['attendees'] });
    expect(p.isMine({ attendees: ['a', 'me'] }, 'me')).toBe(true);
    expect(p.isMine({ attendees: [{ webid: 'me' }] }, 'me')).toBe(true);
    expect(p.isMine({}, 'me')).toBe(false);
  });

  it('every noun a manifest declares facets for is presented from them — none of them in the hard-coded table', () => {
    const declared = new Set();
    for (const m of allManifests()) for (const [noun, d] of Object.entries(m.nouns ?? {})) if (d?.presents) declared.add(noun);
    expect(declared.size).toBeGreaterThanOrEqual(6);
    for (const noun of declared) {
      expect(Object.keys(ITEM_PRESENTERS), noun).not.toContain(noun);
      expect(presenterFor(noun), noun).toBeTruthy();
    }
  });
});
