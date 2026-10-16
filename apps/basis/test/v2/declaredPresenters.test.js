/**
 * A merged view shows a row the way its noun's manifest DECLARES (`presents`: label · moment · order · mine) — so basis
 * never knows a noun by name, and a bot's own noun shows on Vandaag the moment it declares its facets. The hard-coded
 * table (`ITEM_PRESENTERS`) is only the fallback for a canonical noun no manifest declares yet, and it holds no noun a
 * manifest declares.
 */
import { describe, it, expect } from 'vitest';
import { presenterFor, presenterFromFacets, nounsDeclaring } from '../../src/v2/declaredPresenters.js';
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

  it('two manifests declaring facets for one noun is ambiguous: refused, never resolved by catalogue order', () => {
    const decl = (label) => ({ atoms: ['list'], presents: { label, order: 'asc' } });
    const manifests = [{ app: 'a', nouns: { repair: decl('what') } }, { app: 'b', nouns: { repair: decl('title') } }];
    expect(presenterFor('repair', { manifests })).toBe(null);
  });

  it('no noun the app runs is declared by two manifests', () => {
    const by = new Map();
    for (const m of allManifests()) for (const [noun, d] of Object.entries(m.nouns ?? {})) if (d?.presents) by.set(noun, [...(by.get(noun) ?? []), m.app]);
    expect([...by].filter(([, apps]) => apps.length > 1)).toEqual([]);
  });

  it('done reads one declared field: truthy, or one of the declared values', () => {
    const byState = presenterFromFacets({ done: { field: 'state', values: ['done', 'cancelled'] } });
    expect(byState.isDone({ state: 'done' })).toBe(true);
    expect(byState.isDone({ state: 'open' })).toBe(false);
    const byStamp = presenterFromFacets({ done: { field: 'completedAt' } });
    expect(byStamp.isDone({ completedAt: 5 })).toBe(true);
    expect(byStamp.isDone({})).toBe(false);
    expect(presenterFromFacets({}).isDone({ state: 'done' })).toBe(false);   // nothing declared: never done
  });

  it('the nouns a reading covers come from what they declare, never from their names', () => {
    const manifests = [{ app: 'repairbot', nouns: { repair: { atoms: ['list'], presents: { moment: 'due', order: 'asc', mine: ['fixer'], done: { field: 'fixedAt' } } } } }];
    expect(nounsDeclaring((p) => p.order === 'asc', { manifests })).toEqual(['repair']);
    expect(nounsDeclaring((p) => Boolean(p.mine && p.done), { manifests })).toEqual(['repair']);
    expect(nounsDeclaring((p) => p.order === 'desc', { manifests })).toEqual([]);
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
