/**
 * Opening a sealed record decodes UTF-8 ONCE (ledger L619, Fable's ruling 2026-11-19): the envelope around the
 * ciphertext is ASCII by construction (JSON of base64 fields and numbers), so its text comes straight from the base64
 * decode; only the opened plaintext goes through the text decoder. On the phone the decoder is a JavaScript polyfill
 * and the second decode was ~half of opening a record at the alpha size. What opens is unchanged, non-ASCII included.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { seal, open, generateKeypair, sealWithGroupKey, openWithGroupKey, generateGroupKey } from '../src/sealing/envelope.js';

afterEach(() => vi.restoreAllMocks());

describe('a sealed record is decoded once', () => {
  it('group mode: one text decode per open, the plaintext\'s', () => {
    const key = generateGroupKey();
    const sealed = sealWithGroupKey('melk en brood — één keer', key);
    const spy = vi.spyOn(TextDecoder.prototype, 'decode');
    expect(openWithGroupKey(sealed, key)).toBe('melk en brood — één keer');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('recipient mode: one text decode per open, the plaintext\'s', () => {
    const { publicKey, privateKey } = generateKeypair();
    const sealed = seal('{"a":"ü 🥬"}', [publicKey]);
    const spy = vi.spyOn(TextDecoder.prototype, 'decode');
    expect(open(sealed, privateKey)).toBe('{"a":"ü 🥬"}');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an envelope that is not ASCII (not one this code writes) still opens by the full decode', () => {
    const key = generateGroupKey();
    const sealed = sealWithGroupKey('x', key);
    // the same envelope with a non-ASCII field added: it must still parse (the fallback), and open the same
    const prefix = sealed.slice(0, sealed.indexOf(':') + 1);
    const b64 = sealed.slice(prefix.length).replace(/-/g, '+').replace(/_/g, '/');
    const env = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    const bytes = new TextEncoder().encode(JSON.stringify({ ...env, note: 'één' }));
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const widened = prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(openWithGroupKey(widened, key)).toBe('x');
  });
});
