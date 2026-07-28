/**
 * Bootstrap.test.js — Track B / B1 unit tests.
 *
 * Covers:
 *   - factory shape (`create`, `fromSeed`, `fromMnemonic`)
 *   - BIP-39 round-trip (seed → mnemonic → seed; mnemonic → bootstrap → mnemonic)
 *   - HKDF-SHA256 key derivation (deterministic, path-bound, salt-bound)
 *   - bootstrap-derived pubkey fingerprint (stable across instances)
 *   - rotation hook fires + unsubscribe works
 */
import { describe, it, expect } from 'vitest';
import nacl   from 'tweetnacl';
import crypto from 'node:crypto';

import { Bootstrap } from '../../src/identity/Bootstrap.js';
import {
  validateMnemonic,
  mnemonicToSeed,
} from '../../src/identity/Mnemonic.js';

const SALT_LEN = 16;

const arrEq = (a, b) =>
  a instanceof Uint8Array
  && b instanceof Uint8Array
  && a.length === b.length
  && a.every((byte, i) => byte === b[i]);

describe('Bootstrap.create', () => {
  it('returns a Bootstrap and a 24-word mnemonic', () => {
    const { bootstrap, mnemonic } = Bootstrap.create();
    expect(bootstrap).toBeInstanceOf(Bootstrap);
    expect(typeof mnemonic).toBe('string');
    expect(mnemonic.trim().split(/\s+/).length).toBe(24);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it('mnemonic round-trips back to the bootstrap secret', () => {
    const { bootstrap, mnemonic } = Bootstrap.create();
    expect(arrEq(mnemonicToSeed(mnemonic), bootstrap.secret)).toBe(true);
  });

  it('produces a different secret on each call', () => {
    const a = Bootstrap.create().bootstrap.secret;
    const b = Bootstrap.create().bootstrap.secret;
    expect(arrEq(a, b)).toBe(false);
  });

  it('returns a 32-byte secret', () => {
    const { bootstrap } = Bootstrap.create();
    expect(bootstrap.secret).toBeInstanceOf(Uint8Array);
    expect(bootstrap.secret.length).toBe(32);
  });
});

describe('Bootstrap.fromSeed', () => {
  it('round-trips seed → bootstrap → seed', () => {
    const seed = nacl.randomBytes(32);
    const b = Bootstrap.fromSeed(seed);
    expect(arrEq(b.secret, seed)).toBe(true);
  });

  it('rejects wrong-length seeds', () => {
    expect(() => Bootstrap.fromSeed(nacl.randomBytes(16))).toThrow();
    expect(() => Bootstrap.fromSeed(nacl.randomBytes(64))).toThrow();
  });

  it('rejects non-Uint8Array input', () => {
    // eslint-disable-next-line no-new
    expect(() => Bootstrap.fromSeed('a'.repeat(32))).toThrow();
    expect(() => Bootstrap.fromSeed(null)).toThrow();
  });

  it('defensively copies the input — mutating the caller buffer does not change internal state', () => {
    const seed = new Uint8Array(32).fill(7);
    const b    = Bootstrap.fromSeed(seed);
    seed.fill(0);
    expect(b.secret.every(byte => byte === 7)).toBe(true);
  });

  it('the secret getter returns a fresh copy each call', () => {
    const seed = new Uint8Array(32).fill(3);
    const b    = Bootstrap.fromSeed(seed);
    const view = b.secret;
    view.fill(0);
    expect(b.secret.every(byte => byte === 3)).toBe(true);
  });
});

describe('Bootstrap.fromMnemonic', () => {
  it('round-trips mnemonic → bootstrap → mnemonic', () => {
    const { mnemonic: original } = Bootstrap.create();
    const recovered = Bootstrap.fromMnemonic(original);
    expect(recovered.toMnemonic()).toBe(original);
  });

  it('round-trips seed → mnemonic → bootstrap → seed (matches Mnemonic.js semantics)', () => {
    const seed   = nacl.randomBytes(32);
    const phrase = Bootstrap.fromSeed(seed).toMnemonic();
    const back   = Bootstrap.fromMnemonic(phrase);
    expect(arrEq(back.secret, seed)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    const { mnemonic } = Bootstrap.create();
    const b = Bootstrap.fromMnemonic('  ' + mnemonic + '  ');
    expect(b.toMnemonic()).toBe(mnemonic);
  });

  it('throws on invalid BIP-39 phrase', () => {
    expect(() => Bootstrap.fromMnemonic('foo bar baz')).toThrow();
    expect(() => Bootstrap.fromMnemonic('')).toThrow();
    expect(() => Bootstrap.fromMnemonic(null)).toThrow();
  });
});

describe('Bootstrap#deriveResourceKey (HKDF-SHA256)', () => {
  const salt = (n = 1) => new Uint8Array(SALT_LEN).fill(n);

  it('returns a 32-byte Uint8Array', () => {
    const b = Bootstrap.fromSeed(nacl.randomBytes(32));
    const k = b.deriveResourceKey('/devices/foo.enc', salt());
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });

  it('is deterministic for the same (secret, path, salt)', () => {
    const seed = nacl.randomBytes(32);
    const b1 = Bootstrap.fromSeed(seed);
    const b2 = Bootstrap.fromSeed(seed);
    const s = salt(42);
    expect(arrEq(
      b1.deriveResourceKey('/devices/foo.enc', s),
      b2.deriveResourceKey('/devices/foo.enc', s),
    )).toBe(true);
  });

  it('different paths → different keys', () => {
    const b = Bootstrap.fromSeed(nacl.randomBytes(32));
    const s = salt();
    const a = b.deriveResourceKey('/devices/a.enc', s);
    const c = b.deriveResourceKey('/devices/b.enc', s);
    expect(arrEq(a, c)).toBe(false);
  });

  it('different salts → different keys', () => {
    const b = Bootstrap.fromSeed(nacl.randomBytes(32));
    const a = b.deriveResourceKey('/devices/foo.enc', salt(1));
    const c = b.deriveResourceKey('/devices/foo.enc', salt(2));
    expect(arrEq(a, c)).toBe(false);
  });

  it('different secrets → different keys', () => {
    const s = salt();
    const k1 = Bootstrap.fromSeed(nacl.randomBytes(32))
      .deriveResourceKey('/devices/foo.enc', s);
    const k2 = Bootstrap.fromSeed(nacl.randomBytes(32))
      .deriveResourceKey('/devices/foo.enc', s);
    expect(arrEq(k1, k2)).toBe(false);
  });

  it('matches the spec: HKDF-SHA256(ikm=secret, salt, info="onderling-identity-v1:" + path, len=32)', () => {
    const seed = new Uint8Array(32).fill(0xab);
    const b    = Bootstrap.fromSeed(seed);
    const path = '/devices/device-deadbeefcafef00d.enc';
    const s    = new Uint8Array(SALT_LEN).fill(0xcd);
    const expected = new Uint8Array(crypto.hkdfSync(
      'sha256',
      seed,
      s,
      new TextEncoder().encode('onderling-identity-v1:' + path),
      32,
    ));
    expect(arrEq(b.deriveResourceKey(path, s), expected)).toBe(true);
  });

  it('rejects missing or wrong-length salt', () => {
    const b = Bootstrap.fromSeed(nacl.randomBytes(32));
    expect(() => b.deriveResourceKey('/x.enc')).toThrow();
    expect(() => b.deriveResourceKey('/x.enc', new Uint8Array(8))).toThrow();
    expect(() => b.deriveResourceKey('/x.enc', null)).toThrow();
  });

  it('rejects empty / non-string path', () => {
    const b = Bootstrap.fromSeed(nacl.randomBytes(32));
    expect(() => b.deriveResourceKey('', salt())).toThrow();
    expect(() => b.deriveResourceKey(null, salt())).toThrow();
  });

  it('Bootstrap.randomSalt produces a fresh 16-byte salt', () => {
    const a = Bootstrap.randomSalt();
    const b = Bootstrap.randomSalt();
    expect(a.length).toBe(SALT_LEN);
    expect(arrEq(a, b)).toBe(false);
  });
});

describe('Bootstrap#fingerprint + #derivedPubKey', () => {
  it('derivedPubKey is stable across instances created from the same seed', () => {
    const seed = nacl.randomBytes(32);
    const a = Bootstrap.fromSeed(seed).derivedPubKey();
    const b = Bootstrap.fromSeed(seed).derivedPubKey();
    expect(arrEq(a, b)).toBe(true);
    expect(a.length).toBe(32);
  });

  it('different seeds → different derived pubkeys', () => {
    const a = Bootstrap.fromSeed(nacl.randomBytes(32)).derivedPubKey();
    const b = Bootstrap.fromSeed(nacl.randomBytes(32)).derivedPubKey();
    expect(arrEq(a, b)).toBe(false);
  });

  it('fingerprint() defaults to the bootstrap-derived pubkey and is stable', () => {
    const seed = nacl.randomBytes(32);
    const f1 = Bootstrap.fromSeed(seed).fingerprint();
    const f2 = Bootstrap.fromSeed(seed).fingerprint();
    expect(f1).toBe(f2);
  });

  it('fingerprint is 16 hex chars (per identity-pod-schema.md §Container layout)', () => {
    const { bootstrap } = Bootstrap.create();
    const fp = bootstrap.fingerprint();
    expect(typeof fp).toBe('string');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('matches the spec: SHA-256(pubkey).slice(0, 16) hex', () => {
    const seed = new Uint8Array(32).fill(0x11);
    const b    = Bootstrap.fromSeed(seed);
    const expected = crypto.createHash('sha256')
      .update(b.derivedPubKey())
      .digest('hex')
      .slice(0, 16);
    expect(b.fingerprint()).toBe(expected);
  });

  it('accepts an explicit pubkey override', () => {
    const { bootstrap } = Bootstrap.create();
    const otherPub = nacl.sign.keyPair().publicKey;
    const fp = bootstrap.fingerprint(otherPub);
    const expected = crypto.createHash('sha256')
      .update(otherPub)
      .digest('hex')
      .slice(0, 16);
    expect(fp).toBe(expected);
  });

  it('different seeds → different fingerprints', () => {
    const a = Bootstrap.fromSeed(nacl.randomBytes(32)).fingerprint();
    const b = Bootstrap.fromSeed(nacl.randomBytes(32)).fingerprint();
    expect(a).not.toBe(b);
  });

  it('rejects malformed pubkey input', () => {
    const { bootstrap } = Bootstrap.create();
    expect(() => bootstrap.fingerprint(new Uint8Array(16))).toThrow();
    expect(() => bootstrap.fingerprint('not-bytes')).toThrow();
  });
});

describe('Bootstrap#onKeyRotated', () => {
  it('fires when notifyKeyRotated is invoked', () => {
    const { bootstrap } = Bootstrap.create();
    let received = null;
    bootstrap.onKeyRotated(proof => { received = proof; });
    const fakeProof = { type: 'key-rotation', oldPubKey: 'a', newPubKey: 'b' };
    bootstrap.notifyKeyRotated(fakeProof);
    expect(received).toEqual(fakeProof);
  });

  it('supports multiple subscribers', () => {
    const { bootstrap } = Bootstrap.create();
    let countA = 0;
    let countB = 0;
    bootstrap.onKeyRotated(() => { countA++; });
    bootstrap.onKeyRotated(() => { countB++; });
    bootstrap.notifyKeyRotated({});
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('returns an unsubscribe function', () => {
    const { bootstrap } = Bootstrap.create();
    let count = 0;
    const off = bootstrap.onKeyRotated(() => { count++; });
    bootstrap.notifyKeyRotated({});
    off();
    bootstrap.notifyKeyRotated({});
    expect(count).toBe(1);
  });

  it('rejects non-function callbacks', () => {
    const { bootstrap } = Bootstrap.create();
    expect(() => bootstrap.onKeyRotated(null)).toThrow();
    expect(() => bootstrap.onKeyRotated('foo')).toThrow();
  });
});
