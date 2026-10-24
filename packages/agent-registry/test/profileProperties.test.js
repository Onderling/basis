// Identity step 2 — the own/inherit property graph resolution engine.
import { describe, it, expect } from 'vitest';
import {
  own, inherit, normaliseProperties, resolveProperty, effectiveProperties, setOwn, setInherit,
} from '../index.js';

// a tiny profile store: id → { properties }
const store = (profiles) => (id) => profiles[id] ?? null;

describe('profile own/inherit property graph', () => {
  it('an OWN value resolves directly', () => {
    const s = store({ default: { properties: normaliseProperties({ relay: own('wss://r') }) } });
    expect(resolveProperty(s, 'default', 'relay', { defaultProfileId: 'default' })).toBe('wss://r');
  });

  it('a persona-face implicitly inherits the default substrate (undeclared key) but overrides its own', () => {
    const s = store({
      default: { properties: normaliseProperties({ relay: own('wss://r'), name: own('Alice') }) },
      face:    { properties: normaliseProperties({ name: own('Anon') }) },   // only overrides `name`
    });
    expect(resolveProperty(s, 'face', 'relay', { defaultProfileId: 'default' })).toBe('wss://r');   // inherited
    expect(resolveProperty(s, 'face', 'name',  { defaultProfileId: 'default' })).toBe('Anon');      // own wins
  });

  it('an explicit INHERIT follows `from`', () => {
    const s = store({
      base: { properties: normaliseProperties({ relay: own('wss://base') }) },
      face: { properties: normaliseProperties({ relay: inherit('base') }) },
    });
    expect(resolveProperty(s, 'face', 'relay', {})).toBe('wss://base');
  });

  it('a separate device-profile that OWNS a key does NOT inherit it (isolation)', () => {
    const s = store({
      default: { properties: normaliseProperties({ relay: own('wss://home') }) },
      device:  { properties: normaliseProperties({ relay: own('wss://device') }) },
    });
    expect(resolveProperty(s, 'device', 'relay', { defaultProfileId: 'default' })).toBe('wss://device');
  });

  it('the default profile has no parent → an undeclared key is undefined', () => {
    const s = store({ default: { properties: normaliseProperties({ relay: own('wss://r') }) } });
    expect(resolveProperty(s, 'default', 'missing', { defaultProfileId: 'default' })).toBeUndefined();
  });

  it('effectiveProperties merges default + own (own wins)', () => {
    const s = store({
      default: { properties: normaliseProperties({ relay: own('wss://r'), name: own('Alice') }) },
      face:    { properties: normaliseProperties({ name: own('Anon') }) },
    });
    expect(effectiveProperties(s, 'face', { defaultProfileId: 'default' })).toEqual({ relay: 'wss://r', name: 'Anon' });
  });

  it('inherit cycles are safe → undefined (no infinite loop)', () => {
    const s = store({
      a: { properties: normaliseProperties({ x: inherit('b') }) },
      b: { properties: normaliseProperties({ x: inherit('a') }) },
    });
    expect(resolveProperty(s, 'a', 'x', {})).toBeUndefined();
  });

  it('flip own↔inherit re-scopes with no migration (new frozen map)', () => {
    let p = normaliseProperties({ relay: own('wss://r') });
    p = setInherit(p, 'relay');
    expect(p.relay).toEqual({ mode: 'inherit' });
    p = setOwn(p, 'relay', 'wss://new');
    expect(p.relay).toEqual({ mode: 'own', value: 'wss://new' });
  });

  it('normaliseProperties is a strict allowlist (drops junk, coerces mode)', () => {
    const p = normaliseProperties({
      a: { mode: 'own', value: 1 }, b: { mode: 'weird' }, c: 'nope', d: { mode: 'inherit', from: 'x' },
    });
    expect(p.a).toEqual({ mode: 'own', value: 1 });
    expect(p.b).toEqual({ mode: 'inherit' });   // unknown mode → inherit
    expect(p.c).toBeUndefined();                 // non-object → dropped
    expect(p.d).toEqual({ mode: 'inherit', from: 'x' });
  });
});

describe('removeOwn — a property leaves the profile (a removed driver)', () => {
  it('returns a new map without the key; others untouched; an absent key is a no-op', async () => {
    const { removeOwn, setOwn } = await import('../src/profileProperties.js');
    const before = setOwn(setOwn({}, 'goals', { kind: 'goal', text: 'zeilen', tags: ['zeilen'] }), 'place', 'Groningen');
    const after = removeOwn(before, 'goals');
    expect(Object.keys(after)).toEqual(['place']);
    expect(Object.keys(before)).toContain('goals');   // the input is not mutated
    expect(removeOwn(after, 'nope')).toEqual(after);
  });
});
