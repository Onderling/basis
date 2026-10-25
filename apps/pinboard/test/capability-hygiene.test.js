/**
 * Fitness guard (#72, 2026-07-02) — pinboard's B (verb × noun) capability surface must not
 * include its INTERNAL / view-shape itemTypes as member capabilities.
 *
 * `report`, `group-rules`, `rules-accept`, `group-leave` are manifest-shape requirements
 * (a `view.type` must be ∈ `itemTypes`, so these singletons/markers are declared) — NOT
 * content a member creates + manages. A `remove` capability on them is nonsense and clutters
 * the circle freedom matrix. It crept in via `cancelRequest`'s `appliesTo: {type: '*'}`
 * wildcard, which `opNouns` expands to EVERY itemType (same failure mode as basis #79).
 * Narrowing that appliesTo to the real content nouns removed the phantom rows; this test
 * bites if a future `'*'` (or an over-broad appliesTo) re-mints them.
 */
import { describe, it, expect } from 'vitest';
import { capabilitiesOf } from '@onderling/app-manifest';
import { pinboardManifest } from '../manifest.js';

// itemTypes that exist only to satisfy view/manifest shape — never a member capability noun.
const INTERNAL_TYPES = ['report', 'group-rules'];

describe('pinboard capability hygiene', () => {
  const caps = capabilitiesOf(pinboardManifest);
  const nounsWithCaps = new Set(caps.map((c) => c.noun));

  it('does not expose internal/view-shape itemTypes as capabilities', () => {
    const leaked = INTERNAL_TYPES.filter((t) => nounsWithCaps.has(t));
    expect(leaked, `internal itemTypes leaked as capabilities: ${leaked.join(', ')}`).toEqual([]);
  });

  it('still exposes the real content nouns a member manages', () => {
    for (const noun of ['post', 'lend', 'contact', 'member']) {
      expect(nounsWithCaps.has(noun), `missing capabilities for content noun "${noun}"`).toBe(true);
    }
  });
});
