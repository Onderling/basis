// A persona is its own identity on the wire: a stable id (never its display name), and its own AUTHORITY key — derived
// from the owner root for the person, but unrelatable to the root or to another persona for anyone without it.
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { mintProfileId, isReservedProfileLabel, assertProfileId, RESERVED_PROFILE_LABELS } from '../../src/identity/profileIds.js';

const pubOf = (seed) => Buffer.from(nacl.sign.keyPair.fromSeed(seed).publicKey).toString('hex');

describe('a persona id is a stable label, not a name', () => {
  it('mints p-<12 hex>, a fresh one each time', () => {
    const a = mintProfileId(); const b = mintProfileId();
    expect(a).toMatch(/^p-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
  it('refuses the labels the root already uses for something else; default stays allowed', () => {
    for (const label of ['first-device', 'household-export']) {
      expect(isReservedProfileLabel(label)).toBe(true);
      expect(() => assertProfileId(label)).toThrow(/reserved/);
    }
    expect(RESERVED_PROFILE_LABELS).not.toContain('default');
    expect(() => assertProfileId('default')).not.toThrow();
    expect(() => assertProfileId(mintProfileId())).not.toThrow();
    expect(() => assertProfileId('')).toThrow();
    expect(() => assertProfileId('Buurt met spaties')).toThrow(/id/);
  });
});

describe('Bootstrap.deriveProfileAuthority — the persona signs, the root never does', () => {
  it('is deterministic from the phrase: another device re-derives the same authority', () => {
    const { mnemonic } = Bootstrap.create();
    const a = Bootstrap.fromMnemonic(mnemonic).deriveProfileAuthority('default');
    const b = Bootstrap.fromMnemonic(mnemonic).deriveProfileAuthority('default');
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(a).toEqual(b);
  });
  it('two personas, two authorities — and neither is the root, nor the persona\'s chat seed', () => {
    const root = Bootstrap.create().bootstrap;
    const id = mintProfileId();
    const dflt = root.deriveProfileAuthority('default');
    const other = root.deriveProfileAuthority(id);
    expect(pubOf(dflt)).not.toBe(pubOf(other));
    expect(pubOf(dflt)).not.toBe(pubOf(root.secret));
    expect(pubOf(other)).not.toBe(pubOf(root.secret));
    expect(dflt).not.toEqual(root.deriveAgentSeed('default'));
    expect(other).not.toEqual(root.deriveAgentSeed(id));
  });
  it('refuses a reserved or empty label', () => {
    const root = Bootstrap.create().bootstrap;
    expect(() => root.deriveProfileAuthority('first-device')).toThrow(/reserved/);
    expect(() => root.deriveProfileAuthority('')).toThrow();
  });
});
