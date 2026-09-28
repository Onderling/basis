/**
 * atoms — the SDK atom catalogue (B · Layer 1).  Unit tests for the vocabulary,
 * alias resolution, classification, and the invariants other layers rely on.
 */
import { describe, it, expect } from 'vitest';
import {
  ATOMS, ATOM_VERBS, ATOM_VERBS_WITH_ALIASES,
  isAtom, canonicalAtom, classifyVerb, atomFor,
  READ_ATOMS, isWritingVerb, WRITE_SCOPES, verbKind,
} from '../src/atoms.js';
import { VERBS } from '../src/validate.js';

describe('ATOMS catalogue', () => {
  it('every atom has the required shape', () => {
    for (const a of ATOMS) {
      expect(typeof a.verb).toBe('string');
      expect(a.verb.length).toBeGreaterThan(0);
      expect(['crud', 'lifecycle', 'graph']).toContain(a.category);
      expect(['item', 'collection']).toContain(a.targets);
      expect(Array.isArray(a.aliases)).toBe(true);
      expect(typeof a.semantics).toBe('string');
      expect(a.semantics.length).toBeGreaterThan(0);
    }
  });

  it('canonical verbs and aliases are globally unique (no spelling maps to two atoms)', () => {
    const seen = new Set();
    for (const a of ATOMS) {
      for (const spelling of [a.verb, ...a.aliases]) {
        expect(seen.has(spelling)).toBe(false);
        seen.add(spelling);
      }
    }
  });

  it('ATOMS is frozen (drift guard — the vocabulary is authoritative)', () => {
    expect(() => { ATOMS.push({ verb: 'hack' }); }).toThrow();
    expect(() => { ATOM_VERBS.push('hack'); }).toThrow();
  });

  it('is a SUPERSET of the legacy item-store VERBS (back-compat)', () => {
    for (const v of VERBS) expect(ATOM_VERBS).toContain(v);
  });
});

describe('isAtom / canonicalAtom / classifyVerb', () => {
  it('recognises canonical verbs', () => {
    for (const v of ['add', 'list', 'get', 'update', 'remove', 'complete', 'claim', 'share', 'move']) {
      expect(isAtom(v)).toBe(true);
      expect(canonicalAtom(v)).toBe(v);
    }
  });

  it('resolves aliases to their canonical atom', () => {
    expect(canonicalAtom('create')).toBe('add');
    expect(canonicalAtom('delete')).toBe('remove');
    expect(canonicalAtom('assign')).toBe('reassign');
    expect(canonicalAtom('edit')).toBe('update');
    expect(canonicalAtom('patch')).toBe('update');
    expect(canonicalAtom('read')).toBe('get');
    expect(canonicalAtom('grab')).toBe('claim');
    expect(canonicalAtom('done')).toBe('complete');
    expect(ATOM_VERBS_WITH_ALIASES).toContain('create');
  });

  it('rejects domain and unknown verbs', () => {
    for (const v of ['help', 'register', 'sync', 'watch', 'report', 'mute', 'set', 'tree', 'frobnicate']) {
      expect(isAtom(v)).toBe(false);
      expect(canonicalAtom(v)).toBe(null);
      expect(classifyVerb(v)).toBe(null);
    }
  });

  it('classifyVerb flags alias provenance + category', () => {
    expect(classifyVerb('grab')).toMatchObject({ canonical: 'claim', category: 'lifecycle', viaAlias: true });
    expect(classifyVerb('claim')).toMatchObject({ canonical: 'claim', viaAlias: false });
    expect(atomFor('share')).toMatchObject({ category: 'graph' });
  });
});

describe('isWritingVerb / WRITE_SCOPES — which ops must say where they write', () => {
  it('every atom writes except the read atoms, aliases included', () => {
    for (const v of ATOM_VERBS) expect(isWritingVerb(v)).toBe(!READ_ATOMS.includes(v));
    expect(isWritingVerb('edit')).toBe(true);
    expect(isWritingVerb('create')).toBe(true);
    expect(isWritingVerb('read')).toBe(false);
  });
  it('a domain verb is not classified as writing', () => {
    expect(isWritingVerb('help')).toBe(false);
    expect(isWritingVerb(undefined)).toBe(false);
  });
  it('the three scopes, frozen', () => {
    expect(WRITE_SCOPES).toEqual(['device', 'person', 'circle']);
    expect(Object.isFrozen(WRITE_SCOPES)).toBe(true);
  });
});

describe('verbKind — an unclassified domain verb is never a silent read', () => {
  const m = { domainVerbs: { register: 'write', help: 'read', odd: 'sometimes' } };
  it('atoms answer from the catalogue; domain verbs from the manifest map', () => {
    expect(verbKind(m, 'list')).toBe('read');
    expect(verbKind(m, 'add')).toBe('write');
    expect(verbKind(m, 'register')).toBe('write');
    expect(verbKind(m, 'help')).toBe('read');
  });
  it('no verb writes; an unclassified or mis-classified domain verb is null', () => {
    expect(verbKind(m, undefined)).toBe('write');
    expect(verbKind(m, 'frobnicate')).toBe(null);
    expect(verbKind(m, 'odd')).toBe(null);
    expect(verbKind(m, 'constructor')).toBe(null);
    expect(verbKind({ domainVerbs: ['help'] }, 'help')).toBe(null);
  });
});
