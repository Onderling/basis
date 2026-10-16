/**
 * A noun DECLARES how a merged view shows it (`presents`: which plain field is its label, its moment, how it sorts,
 * which fields name whose it is) and what it is called (`names`), so basis builds the view from the declaration and
 * never knows a noun by name. Plain field keys only — no code, no paths into other rows.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/index.js';

const base = (decl) => ({ app: 'x', version: '0.0.1', itemTypes: ['note'], nouns: { note: { atoms: ['add', 'list'], ...decl } }, operations: [] });
const errs = (m) => (validateManifest(m).errors ?? []).filter((e) => String(e.path).startsWith('/nouns'));

describe('a noun\'s presents and names', () => {
  it('a well-formed declaration validates', () => {
    expect(errs(base({ presents: { label: 'text', moment: 'updatedAt', order: 'desc', mine: ['createdBy'] }, names: { nl: 'notitie', en: 'note' } }))).toEqual([]);
  });
  it('a malformed one is refused, field by field', () => {
    const codes = (d) => errs(base(d)).map((e) => e.code);
    expect(codes({ presents: { order: 'sideways' } })).toContain('bad-presents');
    expect(codes({ presents: { moment: 'a.b' } })).toContain('bad-presents');   // a plain key, not a path
    expect(codes({ presents: { mine: 'createdBy' } })).toContain('bad-presents');   // a list of keys
    expect(codes({ presents: { colour: 'red' } })).toContain('bad-presents');   // only the known facets
    expect(codes({ names: { nl: 3 } })).toContain('bad-names');
    // a facet names a field on another app's rows: never an object's own machinery
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      expect(codes({ presents: { label: k } }), k).toContain('bad-presents');
      expect(codes({ presents: { mine: [k] } }), k).toContain('bad-presents');
    }
  });
});
