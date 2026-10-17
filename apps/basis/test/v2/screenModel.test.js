/**
 * screenModel — B · pure projection (filter + categorise + capability-gated row actions).
 */
import { describe, it, expect } from 'vitest';
import { buildScreenModel } from '../../src/v2/screenModel.js';
import { normalizeAudienceRef } from '../../src/v2/circleScope.js';
import { mockTasksManifest } from '../../src/core/manifests/mockManifests.js';
import { buildCapabilityMatrix, capabilityKey } from '@onderling/app-manifest';

const contacts = [
  { id: 'a', label: 'Karin',  category: 'family' },
  { id: 'b', label: 'Klaas',  category: 'buren' },
  { id: 'c', label: 'Anna',   category: 'family' },
  { id: 'd', label: 'Bob',    category: 'buren' },
];

describe('buildScreenModel — text filter', () => {
  it('the "contacten met k" test: filters the label case-insensitively', () => {
    const { rows } = buildScreenModel({ items: contacts, query: 'k' });
    expect(rows.map((r) => r.label)).toEqual(['Karin', 'Klaas']);
  });
  it('empty query returns everything', () => {
    expect(buildScreenModel({ items: contacts }).rows).toHaveLength(4);
  });
});

describe('buildScreenModel — D-mig-2 searchFields (the filter grammar)', () => {
  // Contacts whose label is a display name but whose `handle` is distinct —
  // exactly pinboard's contact row shape (label = displayName ?? handle ?? webid).
  const people = [
    { id: 'a', label: 'Karin de Vries', handle: 'kdv' },
    { id: 'b', label: 'Anna Bakker',    handle: 'zephyr' },   // handle unrelated to label
    { id: 'c', label: 'Bob Jansen',     handle: 'bjan' },
  ];

  it('back-compat: no searchFields ⇒ [labelField] ⇒ label-only search (the "contacten met k")', () => {
    // Identical to the labelField-only default: only labels containing "k".
    const withFields = buildScreenModel({ items: people, query: 'k', searchFields: ['label'] });
    const withoutFields = buildScreenModel({ items: people, query: 'k' });
    expect(withoutFields.rows.map((r) => r.item.id)).toEqual(['a', 'b']);        // Karin, Anna Bakker
    expect(withFields.rows.map((r) => r.item.id)).toEqual(withoutFields.rows.map((r) => r.item.id));
  });

  it('back-compat: the handle field is NOT searched by default (label-only)', () => {
    // 'zephyr' is only in Anna's handle — with no searchFields it must not match.
    const { rows } = buildScreenModel({ items: people, query: 'zephyr' });
    expect(rows).toHaveLength(0);
  });

  it('matches an item that hits the SECOND field but not the label', () => {
    const { rows } = buildScreenModel({ items: people, query: 'zephyr', searchFields: ['label', 'handle'] });
    expect(rows.map((r) => r.item.id)).toEqual(['b']);   // only Anna, via handle
  });

  it('an item matches if ANY searchField contains the query (label OR handle)', () => {
    const { rows } = buildScreenModel({ items: people, query: 'b', searchFields: ['label', 'handle'] });
    // 'b' hits Anna Bakker (label), Bob Jansen (label), bjan (handle b) → a,b,c;
    // Karin has no 'b' in label or handle 'kdv'.
    expect(rows.map((r) => r.item.id)).toEqual(['b', 'c']);
  });

  it('empty searchFields falls back to [labelField] (back-compatible)', () => {
    const { rows } = buildScreenModel({ items: people, query: 'zephyr', searchFields: [] });
    expect(rows).toHaveLength(0);   // handle NOT searched → no label match
  });
});

describe('buildScreenModel — category checkboxes', () => {
  it('lists categories with counts + all-checked by default', () => {
    const { categories } = buildScreenModel({ items: contacts, categoryField: 'category' });
    expect(categories).toEqual([
      { id: 'family', count: 2, checked: true },
      { id: 'buren',  count: 2, checked: true },
    ]);
  });
  it('unchecking a category hides its rows (counts stay full)', () => {
    const m = buildScreenModel({ items: contacts, categoryField: 'category', activeCategories: ['family'] });
    expect(m.rows.map((r) => r.label)).toEqual(['Karin', 'Anna']);
    expect(m.categories.find((c) => c.id === 'buren')).toMatchObject({ count: 2, checked: false });
  });
  it('category + text filter compose', () => {
    const m = buildScreenModel({ items: contacts, query: 'k', categoryField: 'category', activeCategories: ['buren'] });
    expect(m.rows.map((r) => r.label)).toEqual(['Klaas']);   // Karin is family (unchecked)
  });
});

describe('buildScreenModel — capability-gated row actions (reuse Slice 4)', () => {
  const APP = mockTasksManifest.app;
  const tasks = [{ id: 't1', label: 'x', state: 'open', type: 'task' }];
  const manifestsByOrigin = { [APP]: mockTasksManifest };

  it('attaches the item’s capability-gated actions per row', () => {
    const { rows } = buildScreenModel({ items: tasks, manifestsByOrigin, appOrigin: APP });
    expect(rows[0].actions.some((a) => a.opId === 'claimTask')).toBe(true);
  });
  it('a hidden-consequence capability drops the row action (Slice 4 treatment)', () => {
    const matrix = buildCapabilityMatrix([{ manifest: mockTasksManifest }], {
      template: { [capabilityKey(APP, 'claim', 'task')]: { enabled: false, consequence: 'hidden' } },
    });
    const { rows } = buildScreenModel({ items: tasks, manifestsByOrigin, appOrigin: APP, capabilityMatrix: matrix });
    expect(rows[0].actions.some((a) => a.opId === 'claimTask')).toBe(false);
  });
});

describe('buildScreenModel — SP-5b audience filter (view.defaultAudience → ListFilter.audience)', () => {
  // Items with an effective audience (via item-store's audienceFromItem:
  // `audience` field wins, else legacy `visibility`, else 'household').
  const items = [
    { id: 'a', label: 'Alpha', audience: 'circle:abc' },
    { id: 'b', label: 'Bravo', audience: 'circle:xyz' },
    { id: 'c', label: 'Charlie', visibility: 'circle:abc' }, // legacy field resolves too
    { id: 'd', label: 'Delta' },                            // → 'household' default
  ];

  it('defaultAudience filters the list to items whose effective audience matches', () => {
    const { rows } = buildScreenModel({ items, defaultAudience: 'circle:abc' });
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'c']);
  });

  it('no defaultAudience/audience → list unchanged (back-compatible)', () => {
    const { rows } = buildScreenModel({ items });
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('explicit audience OVERRIDES the view default', () => {
    const { rows } = buildScreenModel({ items, defaultAudience: 'circle:abc', audience: 'circle:xyz' });
    expect(rows.map((r) => r.item.id)).toEqual(['b']);
  });

  it('the household default matches items with no audience field', () => {
    const { rows } = buildScreenModel({ items, defaultAudience: 'household' });
    expect(rows.map((r) => r.item.id)).toEqual(['d']);
  });

  it('normalises circle-ref spelling: a circle:X view matches STRUCTURED {kind:circle-ref} items', () => {
    // The reachable gap: a view declares `defaultAudience: 'circle:abc'` (string
    // short-hand) but items created through a @onderling/circles / saved-view path
    // store the STRUCTURED form.  Pre-fix, item-store's strict-equality match
    // silently dropped them; buildScreenModel now injects a circle-ref
    // canonicaliser so both spellings compare equal.
    const mixed = [
      { id: 'a', label: 'Alpha', audience: 'circle:abc' },                       // string short-hand
      { id: 'b', label: 'Bravo', audience: { kind: 'circle-ref', id: 'abc' } },  // structured — same circle
      { id: 'c', label: 'Charlie', audience: { kind: 'circle-ref', id: 'xyz' } },// structured — other circle
    ];
    const { rows } = buildScreenModel({ items: mixed, defaultAudience: 'circle:abc' });
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'b']);
  });

  it('normalises the other direction: a structured view audience matches circle:X items', () => {
    const mixed = [
      { id: 'a', label: 'Alpha', audience: 'circle:abc' },
      { id: 'b', label: 'Bravo', audience: 'circle:xyz' },
    ];
    const { rows } = buildScreenModel({ items: mixed, defaultAudience: { kind: 'circle-ref', id: 'abc' } });
    expect(rows.map((r) => r.item.id)).toEqual(['a']);
  });

  it('normalisation reaches into a union audience on the item', () => {
    const items = [
      { id: 'a', label: 'Alpha', audience: { kind: 'union', of: ['household', { kind: 'circle-ref', id: 'abc' }] } },
      { id: 'b', label: 'Bravo', audience: { kind: 'union', of: ['household', { kind: 'circle-ref', id: 'xyz' }] } },
    ];
    const { rows } = buildScreenModel({ items, defaultAudience: 'circle:abc' });
    expect(rows.map((r) => r.item.id)).toEqual(['a']);
  });

  it('SP-5b Option A: audienceScope carries the normalised scope when scoped, null when not', () => {
    // Unscoped → null (no caption should render).
    expect(buildScreenModel({ items }).audienceScope).toBeNull();
    // Scoped by a view default → the normalised audience it filtered by.
    expect(buildScreenModel({ items, defaultAudience: 'circle:abc' }).audienceScope)
      .toEqual(normalizeAudienceRef('circle:abc'));
    // Explicit audience wins over the view default → reflected in the scope.
    expect(buildScreenModel({ items, defaultAudience: 'circle:abc', audience: 'circle:xyz' }).audienceScope)
      .toEqual(normalizeAudienceRef('circle:xyz'));
  });

  it('audience filter also constrains category checkboxes + counts', () => {
    const cat = [
      { id: 'a', label: 'Alpha', category: 'x', audience: 'circle:abc' },
      { id: 'b', label: 'Bravo', category: 'y', audience: 'circle:xyz' },
      { id: 'c', label: 'Charlie', category: 'x', audience: 'circle:abc' },
    ];
    const { categories } = buildScreenModel({ items: cat, categoryField: 'category', defaultAudience: 'circle:abc' });
    expect(categories).toEqual([{ id: 'x', count: 2, checked: true }]);
  });
});
