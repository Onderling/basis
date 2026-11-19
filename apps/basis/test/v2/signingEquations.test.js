/**
 * The shells' signing glue (ledger L619): the box's node:crypto and the phone's libsodium (here a stand-in with the
 * same calls, backed by tweetnacl) are taken by the kernel, and sign and derive the same bytes as tweetnacl.
 */
import { describe, it, expect, afterEach } from 'vitest';
import nodeCrypto from 'node:crypto';
import nacl from 'tweetnacl';
import { ed25519KeyPairFromSeed, ed25519Sign, useSigningEquation, signingEquationName } from '@onderling/core';
import { installBoxSigning, installPhoneSigning } from '../../src/v2/signatureEquations.js';

afterEach(() => useSigningEquation(null));
const seed = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const msg = new TextEncoder().encode('een appel per dag');

describe('the shells install signing that gives tweetnacl\'s bytes', () => {
  it('the box: node:crypto', () => {
    expect(installBoxSigning(nodeCrypto)).toMatchObject({ ok: true, name: 'node-crypto' });
    expect(signingEquationName()).toBe('node-crypto');
    const kp = ed25519KeyPairFromSeed(seed);
    const ref = nacl.sign.keyPair.fromSeed(seed);
    expect([...kp.secretKey]).toEqual([...ref.secretKey]);
    expect([...ed25519Sign(msg, kp.secretKey)]).toEqual([...nacl.sign.detached(msg, ref.secretKey)]);
  });

  it('the phone: libsodium\'s calls (crypto_sign_seed_keypair answers privateKey, as react-native-libsodium does)', () => {
    const sodium = {
      crypto_sign_seed_keypair: (s) => { const k = nacl.sign.keyPair.fromSeed(s); return { keyType: 'ed25519', publicKey: k.publicKey, privateKey: k.secretKey }; },
      crypto_sign_detached: (m, sk) => nacl.sign.detached(m, sk),
    };
    expect(installPhoneSigning(sodium)).toMatchObject({ ok: true, name: 'libsodium-jsi' });
  });

  it('a module whose bytes differ is refused, and tweetnacl stays', () => {
    const bad = { crypto_sign_seed_keypair: () => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(64) }), crypto_sign_detached: () => new Uint8Array(64) };
    expect(installPhoneSigning(bad)).toMatchObject({ ok: false, reason: 'key-pair-disagrees' });
    expect(signingEquationName()).toBe('tweetnacl');
  });
});
