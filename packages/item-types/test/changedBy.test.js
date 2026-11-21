/**
 * EVERY TYPE SAYS WHO MAY CHANGE AND REMOVE ITS ROWS (`changedBy`: 'author' or 'circle'), judged by each receiving
 * device. A type with none would count as 'author' silently; this is red for one, so each type is decided on purpose.
 */
import { describe, it, expect } from 'vitest';
import { createRegistry, registerCanonicalTypes, CHANGED_BY } from '../index.js';
import { CANONICAL_TYPES } from '../src/canonical.js';

describe('changedBy is declared for every type', () => {
  it('every canonical type has a value, and only the two values', () => {
    const missing = Object.keys(CANONICAL_TYPES).filter((t) => !(t in CHANGED_BY));
    expect(missing, 'canonical types with no changedBy').toEqual([]);
    expect(Object.values(CHANGED_BY).every((v) => v === 'author' || v === 'circle')).toBe(true);
  });
  it('the registry hands it on with the schema', () => {
    const r = createRegistry(); registerCanonicalTypes(r);
    expect(r.schema('list-item').changedBy).toBe('circle');
    expect(r.schema('note').changedBy).toBe('author');
    const note = { type: 'note', id: 'n', body: 'x', createdAt: '2026-11-21T10:00:00Z', createdBy: 'webid:a' };
    expect(r.validate(note).ok, JSON.stringify(r.validate(note).errors)).toBe(true);
  });
});
