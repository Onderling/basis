/**
 * A type's validator is compiled on its first use, not at registration.
 *
 * Measured on a phone (Hermes, 2026-10-23): ajv's compile of the canonical set took ~1.4 s of the boot, for every
 * registry the shell creates, while most types are never validated in a session. Registration still rejects a
 * malformed schema (a meta-schema check, no compile), so a bad schema fails where it always failed.
 */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/registry.js';
import { registerCanonicalTypes } from '../src/canonical.js';

const SCHEMA = {
  type: 'object',
  required: ['type', 'title'],
  properties: { type: { const: 'note' }, title: { type: 'string', minLength: 1 } },
};

describe('lazy validator compile', () => {
  it('registering the canonical set compiles nothing', () => {
    const r = createRegistry();
    registerCanonicalTypes(r);
    expect(r.list().length).toBeGreaterThan(0);
    expect(r._compiledCount()).toBe(0);
  });

  it('the first validate compiles that one type, and only once', () => {
    const r = createRegistry();
    r.registerType('note', SCHEMA);
    r.registerType('other', { type: 'object' });
    expect(r.validate({ type: 'note', title: 'x' })).toEqual({ ok: true });
    expect(r._compiledCount()).toBe(1);
    r.validate({ type: 'note', title: 'y' });
    expect(r._compiledCount()).toBe(1);
  });

  it('gives the same answers as before: errors included', () => {
    const r = createRegistry();
    r.registerType('note', SCHEMA, { aliases: ['memo'] });
    const bad = r.validate({ type: 'note', title: '' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.instancePath)).toEqual(['/title']);
    expect(r.validate({ type: 'memo', title: 'via alias' })).toEqual({ ok: true });
  });

  it('a malformed schema still fails at registration, and leaves no entry', () => {
    const r = createRegistry();
    expect(() => r.registerType('bad', { type: 'not-a-real-type' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
    expect(r.list()).toEqual([]);
  });

  it('a schema that passes the meta check but cannot compile reports it on use, not as valid', () => {
    const r = createRegistry();
    r.registerType('dangling', { $ref: '#/definitions/nowhere' });
    const res = r.validate({ type: 'dangling' });
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toMatch(/failed to compile/);
  });
});
