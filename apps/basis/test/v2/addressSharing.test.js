/**
 * "Never share my global address" — the publication lock (Frits, 2026-07-29).
 *
 * Distinct from the address-fallback setting: that one governs ROUTING (may a send fall back to my
 * global key?), this governs PUBLICATION (may my global address leave this device at all?). The concern
 * is persona collapse — an address seen in two contexts proves those contexts are the same person, no
 * matter how careful the routing was.
 *
 * The load-bearing tests are the failure directions: a corrupt setting must not silently make someone
 * unreachable, and a publication site that forgets to check must fail SAFE.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHARE_NKN_ADDRESS, normalizeShareNknAddress, shareableAddress,
  localStorageAddressSharingIo,
} from '../../src/v2/addressSharing.js';
import { publishPeerAddr } from '../../src/web/podStorage.js';

describe('the setting', () => {
  it('defaults to sharing — the alternative is an app that silently cannot be contacted', () => {
    expect(DEFAULT_SHARE_NKN_ADDRESS).toBe(true);
    expect(normalizeShareNknAddress(undefined)).toBe(true);
  });

  it('only an explicit false turns it off; anything corrupt reads as the DEFAULT', () => {
    expect(normalizeShareNknAddress(false)).toBe(false);
    expect(normalizeShareNknAddress('false')).toBe(false);
    // A garbled store must not silently make the user unreachable — they never chose that.
    for (const junk of [null, 0, 'nope', {}, 'true', 1]) {
      expect(normalizeShareNknAddress(junk)).toBe(true);
    }
  });
});

describe('shareableAddress — the one gate every publication site calls', () => {
  it('returns the address when sharing is on', () => {
    expect(shareableAddress('app.abc', true)).toBe('app.abc');
  });

  it('returns NULL when off — so a site that forgets to check reads it as "no address"', () => {
    expect(shareableAddress('app.abc', false)).toBeNull();
  });

  it('reads a thunk per call, so flipping the setting takes effect immediately', () => {
    let on = true;
    const get = () => on;
    expect(shareableAddress('app.abc', get)).toBe('app.abc');
    on = false;
    expect(shareableAddress('app.abc', get)).toBeNull();   // no boot-captured boolean
  });

  it('a missing address is null regardless of the setting', () => {
    expect(shareableAddress(null, true)).toBeNull();
    expect(shareableAddress('', true)).toBeNull();
  });
});

describe('the escape points refuse at the source', () => {
  it('publishPeerAddr REFUSES rather than writing — the pod copy is the longest-lived one', async () => {
    const writes = [];
    const writer = { write: async (...a) => { writes.push(a); return { ok: true }; } };
    const r = await publishPeerAddr(writer, 'app.abc', { allowed: false });
    expect(r).toMatchObject({ ok: false, refused: 'address-sharing-off' });
    expect(writes).toHaveLength(0);          // nothing reached the pod
  });

  it('…and writes normally when allowed', async () => {
    const writes = [];
    const writer = { write: async (...a) => { writes.push(a); return { ok: true, url: 'u', status: 201 }; } };
    await publishPeerAddr(writer, 'app.abc', { allowed: true });
    expect(writes).toHaveLength(1);
    expect(String(writes[0][2])).toContain('app.abc');
  });

  it('refusing is reported, not thrown — a lock working is not an error', async () => {
    const writer = { write: async () => ({ ok: true }) };
    await expect(publishPeerAddr(writer, 'app.abc', { allowed: false })).resolves.toBeTruthy();
  });
});

describe('persistence', () => {
  it('only the non-default is stored — no key means "I never changed this"', () => {
    const mem = new Map();
    const io = localStorageAddressSharingIo({
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    });
    io.save(false);
    expect(io.load()).toBe(false);
    io.save(true);
    expect(mem.size).toBe(0);
    expect(io.load()).toBe(true);
  });

  it('a broken storage read degrades to sharing, not to silent unreachability', () => {
    const io = localStorageAddressSharingIo({ getItem: () => { throw new Error('nope'); }, setItem: () => {}, removeItem: () => {} });
    expect(io.load()).toBe(true);
  });
});
