// Property layer Phase 1 — the canonical Request record + the governed-request check.
import { describe, it, expect } from 'vitest';
import { createRequest, requestHash, requestKeys } from '../src/request.js';
import { checkRequestAllowed, DEFAULT_GOVERNED_POLICY } from '../src/governedRequest.js';
import { createVocabulary, descriptor } from '../src/propertyVocabulary.js';

const vocab = createVocabulary([
  descriptor({ key: 'place', type: 'coarse-enum' }),
  descriptor({ key: 'ageBand', type: 'coarse-enum' }),
  descriptor({ key: 'health', type: 'coded', sensitivity: 'special-category' }),
]);

describe('createRequest', () => {
  it('builds a canonical request (items sorted by key)', () => {
    const r = createRequest({ requesterId: 'circle-42', purpose: 'segment feedback', items: [
      { key: 'place', why: 'which circles' }, { key: 'ageBand', why: 'age spread' },
    ] });
    expect(requestKeys(r)).toEqual(['ageBand', 'place']);   // sorted
    expect(r.requesterId).toBe('circle-42');
  });

  it('requires requesterId, purpose, ≥1 item, and a per-item why', () => {
    expect(() => createRequest({ purpose: 'x', items: [{ key: 'place', why: 'w' }] })).toThrow(/requesterId/);
    expect(() => createRequest({ requesterId: 'r', items: [{ key: 'place', why: 'w' }] })).toThrow(/purpose/);
    expect(() => createRequest({ requesterId: 'r', purpose: 'p', items: [] })).toThrow(/at least one/);
    expect(() => createRequest({ requesterId: 'r', purpose: 'p', items: [{ key: 'place' }] })).toThrow(/why/);
  });

  it('rejects duplicate keys', () => {
    expect(() => createRequest({ requesterId: 'r', purpose: 'p', items: [
      { key: 'place', why: 'a' }, { key: 'place', why: 'b' }] })).toThrow(/duplicate/);
  });

  it('validates against a vocabulary (unknown key + type conflict) and fills type from it', () => {
    expect(() => createRequest({ requesterId: 'r', purpose: 'p', vocabulary: vocab,
      items: [{ key: 'income', why: 'w' }] })).toThrow(/not in the vocabulary/);
    expect(() => createRequest({ requesterId: 'r', purpose: 'p', vocabulary: vocab,
      items: [{ key: 'place', why: 'w', type: 'driver' }] })).toThrow(/conflicts/);
    const r = createRequest({ requesterId: 'r', purpose: 'p', vocabulary: vocab, items: [{ key: 'place', why: 'w' }] });
    expect(r.items[0].type).toBe('coarse-enum');   // filled from the vocabulary
  });
});

describe('requestHash', () => {
  it('is deterministic + order-independent; changes on any content change', () => {
    const a = createRequest({ requesterId: 'r', purpose: 'p', items: [{ key: 'place', why: 'a' }, { key: 'ageBand', why: 'b' }] });
    const b = createRequest({ requesterId: 'r', purpose: 'p', items: [{ key: 'ageBand', why: 'b' }, { key: 'place', why: 'a' }] });
    expect(requestHash(a)).toBe(requestHash(b));
    expect(requestHash(a)).toMatch(/^[0-9a-f]{64}$/);
    const c = createRequest({ requesterId: 'r', purpose: 'DIFFERENT', items: [{ key: 'place', why: 'a' }, { key: 'ageBand', why: 'b' }] });
    expect(requestHash(c)).not.toBe(requestHash(a));
  });
});

describe('checkRequestAllowed (governed request side)', () => {
  it('forbids special-category / health asks in an employment context', () => {
    const req = createRequest({ requesterId: 'acme', purpose: 'hiring', vocabulary: vocab, items: [
      { key: 'health', why: 'fitness for duty' }, { key: 'ageBand', why: 'team fit' },
    ] });
    const v = checkRequestAllowed(req, 'employment', DEFAULT_GOVERNED_POLICY, vocab);
    expect(v.allowed).toBe(false);
    expect(v.forbidden.sort()).toEqual(['ageBand', 'health']);   // both forbidden in hiring
  });

  it('allows a benign ask + surfaces warns; no rule for a context → allowed', () => {
    const req = createRequest({ requesterId: 'circle', purpose: 'segment', vocabulary: vocab, items: [{ key: 'place', why: 'w' }] });
    expect(checkRequestAllowed(req, 'employment', DEFAULT_GOVERNED_POLICY, vocab)).toEqual({ allowed: true, forbidden: [], warn: [] });
    const t = checkRequestAllowed(createRequest({ requesterId: 'll', purpose: 'rent', vocabulary: vocab, items: [{ key: 'ageBand', why: 'w' }] }), 'tenancy', DEFAULT_GOVERNED_POLICY, vocab);
    expect(t).toEqual({ allowed: true, forbidden: [], warn: ['ageBand'] });   // warned, not forbidden
    expect(checkRequestAllowed(req, 'community-feedback', DEFAULT_GOVERNED_POLICY, vocab).allowed).toBe(true);  // ungoverned context
  });

  it('forbids a coded TYPE by type, not just by key', () => {
    const req = createRequest({ requesterId: 'acme', purpose: 'hiring', vocabulary: vocab, items: [{ key: 'health', why: 'w' }] });
    // 'health' is coded/special-category → caught by forbidTypes even if the key weren't listed.
    expect(checkRequestAllowed(req, 'tenancy', DEFAULT_GOVERNED_POLICY, vocab).allowed).toBe(false);
  });
});
