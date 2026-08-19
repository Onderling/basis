/**
 * skillParts — pure-helper coverage. Mirrors the assertions
 * apps/stoop-mobile/test/useSkill.test.js exercises through the
 * re-export shim.
 */

import { describe, it, expect } from 'vitest';
import { toParts, unwrapParts } from '../../src/react/skillParts.js';

describe('@onderling/sync-engine-rn/react skillParts.unwrapParts', () => {
  it('returns the first DataPart\'s data', () => {
    expect(unwrapParts([
      { type: 'TextPart', text: 'hi' },
      { type: 'DataPart', data: { items: [1, 2, 3] } },
    ])).toEqual({ items: [1, 2, 3] });
  });
  it('returns {} when no DataPart is present', () => {
    expect(unwrapParts([{ type: 'TextPart', text: 'hi' }])).toEqual({});
  });
  it('returns {} for empty / null input', () => {
    expect(unwrapParts([])).toEqual({});
    expect(unwrapParts(null)).toEqual({});
    expect(unwrapParts(undefined)).toEqual({});
  });
  it('passes through non-array inputs (forward-compat)', () => {
    const obj = { items: [] };
    expect(unwrapParts(obj)).toBe(obj);
  });
});

describe('@onderling/sync-engine-rn/react skillParts.toParts', () => {
  it('wraps an object in a single DataPart', () => {
    expect(toParts({ kind: 'ask' })).toEqual([
      { type: 'DataPart', data: { kind: 'ask' } },
    ]);
  });
  it('passes arrays through verbatim', () => {
    const arr = [{ type: 'TextPart', text: 'hi' }, { type: 'DataPart', data: {} }];
    expect(toParts(arr)).toBe(arr);
  });
  it('returns [] for null / undefined', () => {
    expect(toParts(null)).toEqual([]);
    expect(toParts(undefined)).toEqual([]);
  });
});
