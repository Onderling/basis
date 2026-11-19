/**
 * The secretbox port's own contract (ledger L619): fixed vectors written down as bytes, so vetting an implementation at a
 * start runs no tweetnacl; tweetnacl still gives exactly those bytes; an implementation that seals other bytes or opens a
 * forgery is refused. The phone's libsodium implementation and the routed call sites are tested in apps/basis
 * (`secretboxPort.test.js`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import { useSecretbox, secretboxName, SECRETBOX_VECTORS, SECRETBOX_LARGE, largeSecretboxMessage } from '../src/crypto/secretbox.js';

const hex = (u) => Buffer.from(u).toString('hex');

/** A table-driven fake: answers the small vectors from their constants, and the large message with a box built from the
 *  pinned parts (its middle is filler); it opens exactly the boxes it made. No tweetnacl. */
function tableFake() {
  const { key, msgs, expected } = SECRETBOX_VECTORS;
  const L = SECRETBOX_LARGE;
  let large = null;
  return {
    name: 'table',
    seal: (m) => {
      if (m.length === L.length) {
        const b = new Uint8Array(L.boxLength);
        b.set(Buffer.from(L.tag, 'hex'), 0); b.set(Buffer.from(L.head, 'hex'), 16); b.set(Buffer.from(L.tail, 'hex'), L.boxLength - 64);
        large = b; return Uint8Array.from(b);
      }
      return Uint8Array.from(Buffer.from(expected[msgs.findIndex((x) => hex(x) === hex(m))], 'hex'));
    },
    open: (b, n, k) => {
      if (hex(k) !== hex(key)) return null;
      if (large && b.length === large.length && Buffer.from(b).equals(Buffer.from(large))) return largeSecretboxMessage();
      const i = expected.indexOf(hex(b)); return i >= 0 ? Uint8Array.from(msgs[i]) : null;
    },
  };
}

afterEach(() => { useSecretbox(null); vi.restoreAllMocks(); });

describe('the fixed vectors', () => {
  it('tweetnacl still gives exactly these boxes, and opens them', () => {
    const { key, nonce, msgs, expected } = SECRETBOX_VECTORS;
    msgs.forEach((m, i) => {
      expect(Buffer.from(nacl.secretbox(m, nonce, key)).toString('hex')).toBe(expected[i]);
      expect(nacl.secretbox.open(Uint8Array.from(Buffer.from(expected[i], 'hex')), nonce, key)).toEqual(m);
    });
  });

  it('tweetnacl still gives the large message\'s pinned parts: length, authenticator, first and last 64 bytes', () => {
    const { key, nonce } = SECRETBOX_VECTORS;
    const L = SECRETBOX_LARGE;
    const box = nacl.secretbox(largeSecretboxMessage(), nonce, key);
    expect(box.length).toBe(L.boxLength);
    expect(hex(box.subarray(0, 16))).toBe(L.tag);
    expect(hex(box.subarray(16, 80))).toBe(L.head);
    expect(hex(box.subarray(box.length - 64))).toBe(L.tail);
  });

  it('installing an implementation that answers from the vectors runs no tweetnacl', () => {
    const s = vi.spyOn(nacl, 'secretbox');
    const t0 = performance.now();
    expect(useSecretbox(tableFake())).toMatchObject({ ok: true, name: 'table' });
    const ms = performance.now() - t0;
    console.info(`[secretbox] vetting with the table fake (no crypto): ${ms.toFixed(1)} ms`);
    expect(s).not.toHaveBeenCalled();
  });

  it('refuses one that is right below 64 kB and wrong above (a bridge length limit): large-message-disagrees', () => {
    const seal = nacl.secretbox; const open = nacl.secretbox.open;
    const capped = (m) => (m.length > 65536 ? m.subarray(0, 65536) : m);
    expect(useSecretbox({ name: 'capped', seal: (m, n, k) => seal(capped(m), n, k), open })).toMatchObject({ ok: false, reason: 'large-message-disagrees' });
    // one whose large seal is right but whose large open truncates is refused the same way
    expect(useSecretbox({ name: 'capped-open', seal, open: (b, n, k) => { const o = open(b, n, k); return o && o.length > 65536 ? o.subarray(0, 65536) : o; } })).toMatchObject({ ok: false, reason: 'large-message-disagrees' });
    expect(secretboxName()).toBe('tweetnacl');
  });

  it('refuses one that opens a forgery, one that seals other bytes, and keeps tweetnacl', () => {
    const seal = nacl.secretbox; const open = nacl.secretbox.open;
    expect(useSecretbox({ name: 'lax', seal, open: (b, n, k) => open(b, n, k) ?? new Uint8Array(0) })).toMatchObject({ ok: false, reason: 'opens-a-forgery' });
    expect(useSecretbox({ name: 'wrong', seal: (m, n, k) => seal(m, n, k).reverse(), open })).toMatchObject({ ok: false, reason: 'seal-disagrees' });
    expect(secretboxName()).toBe('tweetnacl');
  });
});

