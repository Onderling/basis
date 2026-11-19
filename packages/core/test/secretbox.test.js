/**
 * The secretbox port's own contract (ledger L619): fixed vectors written down as bytes, so vetting an implementation at a
 * start runs no tweetnacl; tweetnacl still gives exactly those bytes; an implementation that seals other bytes or opens a
 * forgery is refused. The phone's libsodium implementation and the routed call sites are tested in apps/basis
 * (`secretboxPort.test.js`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import { useSecretbox, secretboxName, SECRETBOX_VECTORS } from '../src/crypto/secretbox.js';

afterEach(() => { useSecretbox(null); vi.restoreAllMocks(); });

describe('the fixed vectors', () => {
  it('tweetnacl still gives exactly these boxes, and opens them', () => {
    const { key, nonce, msgs, expected } = SECRETBOX_VECTORS;
    msgs.forEach((m, i) => {
      expect(Buffer.from(nacl.secretbox(m, nonce, key)).toString('hex')).toBe(expected[i]);
      expect(nacl.secretbox.open(Uint8Array.from(Buffer.from(expected[i], 'hex')), nonce, key)).toEqual(m);
    });
  });

  it('installing an implementation that answers from the vectors runs no tweetnacl', () => {
    const { key, msgs, expected } = SECRETBOX_VECTORS;
    const hex = (u) => Buffer.from(u).toString('hex');
    const table = {
      name: 'table',
      seal: (m) => Uint8Array.from(Buffer.from(expected[msgs.findIndex((x) => hex(x) === hex(m))], 'hex')),
      open: (b, n, k) => { const i = expected.indexOf(hex(b)); return i >= 0 && hex(k) === hex(key) ? Uint8Array.from(msgs[i]) : null; },
    };
    const s = vi.spyOn(nacl, 'secretbox');
    expect(useSecretbox(table)).toMatchObject({ ok: true, name: 'table' });
    expect(s).not.toHaveBeenCalled();
  });

  it('refuses one that opens a forgery, one that seals other bytes, and keeps tweetnacl', () => {
    const seal = nacl.secretbox; const open = nacl.secretbox.open;
    expect(useSecretbox({ name: 'lax', seal, open: (b, n, k) => open(b, n, k) ?? new Uint8Array(0) })).toMatchObject({ ok: false, reason: 'opens-a-forgery' });
    expect(useSecretbox({ name: 'wrong', seal: (m, n, k) => seal(m, n, k).reverse(), open })).toMatchObject({ ok: false, reason: 'seal-disagrees' });
    expect(secretboxName()).toBe('tweetnacl');
  });
});

