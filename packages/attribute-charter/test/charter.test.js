// Charter: coarse-only, capped, immutable, deterministically hashable.
import { describe, it, expect } from 'vitest';
import { createCharter, charterHash, charterKeys, CHARTER_MAX_ATTRIBUTES } from '../src/charter.js';

const ok = { projectId: 'circle-42', attributes: [
  { key: 'place', purpose: 'which circles are represented' },
  { key: 'ageBand', purpose: 'age spread' },
] };

describe('createCharter', () => {
  it('builds a canonical charter (keys sorted, version defaults to 1)', () => {
    const c = createCharter(ok);
    expect(c.version).toBe(1);
    expect(charterKeys(c)).toEqual(['ageBand', 'place']);   // sorted
  });

  it('rejects more than the cap', () => {
    const tooMany = { projectId: 'p', attributes: [
      { key: 'place', purpose: 'a' }, { key: 'ageBand', purpose: 'b' },
      { key: 'role', purpose: 'c' }, { key: 'tenure', purpose: 'd' },
    ] };
    expect(() => createCharter(tooMany)).toThrow(/at most 3/);
    expect(CHARTER_MAX_ATTRIBUTES).toBe(3);
  });

  it('rejects an unknown / off-vocabulary attribute', () => {
    expect(() => createCharter({ projectId: 'p', attributes: [{ key: 'income', purpose: 'x' }] }))
      .toThrow(/unknown attribute key/);
  });

  it('rejects a duplicate key and a missing purpose', () => {
    expect(() => createCharter({ projectId: 'p', attributes: [
      { key: 'role', purpose: 'a' }, { key: 'role', purpose: 'b' }] })).toThrow(/duplicate/);
    expect(() => createCharter({ projectId: 'p', attributes: [{ key: 'role', purpose: '  ' }] }))
      .toThrow(/purpose/);
  });

  it('requires at least one attribute + a projectId', () => {
    expect(() => createCharter({ projectId: 'p', attributes: [] })).toThrow(/at least one/);
    expect(() => createCharter({ attributes: ok.attributes })).toThrow(/projectId/);
  });
});

describe('charterHash', () => {
  it('is deterministic + order-independent (same content → same hash)', () => {
    const a = createCharter(ok);
    const b = createCharter({ projectId: 'circle-42', attributes: [ok.attributes[1], ok.attributes[0]] });
    expect(charterHash(a)).toBe(charterHash(b));
    expect(charterHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the requested set OR the version changes (immutability proof)', () => {
    const base = createCharter(ok);
    const moreAttrs = createCharter({ ...ok, attributes: [...ok.attributes, { key: 'role', purpose: 'r' }] });
    const newVersion = createCharter({ ...ok, version: 2 });
    expect(charterHash(moreAttrs)).not.toBe(charterHash(base));
    expect(charterHash(newVersion)).not.toBe(charterHash(base));
  });
});
