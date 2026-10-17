/**
 * OidcSessionRN tests — token-lifecycle, refresh, persistence keys.
 *
 * Mirrors `apps/folio-mobile/test/auth.test.js` (which the substrate
 * was lifted from) but exercises the appId-prefix surface.
 */

import { describe, it, expect, vi } from 'vitest';
import { OidcSessionRN, buildSecureStoreKeys, DEFAULT_APP_ID } from '../src/OidcSessionRN.js';

function buildStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItemAsync:    vi.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    setItemAsync:    vi.fn(async (k, v) => { m.set(k, String(v)); }),
    deleteItemAsync: vi.fn(async (k) => { m.delete(k); }),
    _peek: () => Object.fromEntries(m),
    _set:  (k, v) => m.set(k, v),
  };
}

describe('buildSecureStoreKeys', () => {
  it('default appId produces oidc-prefixed keys', () => {
    const k = buildSecureStoreKeys();
    expect(k.ACCESS_TOKEN).toBe('oidc-oidc-access-token');
    expect(DEFAULT_APP_ID).toBe('oidc');
  });

  it('folio appId reproduces the legacy folio-oidc-* keys (migration target)', () => {
    const k = buildSecureStoreKeys('folio');
    expect(k.ACCESS_TOKEN).toBe('folio-oidc-access-token');
    expect(k.CLIENT_ID).toBe('folio-oidc-client-id');
  });

  it('pinboard appId produces pinboard-oidc-* keys', () => {
    const k = buildSecureStoreKeys('pinboard');
    expect(k.ACCESS_TOKEN).toBe('pinboard-oidc-access-token');
  });

  it('rejects illegal characters in appId', () => {
    expect(() => buildSecureStoreKeys('with spaces')).toThrow(/appId must match/);
    expect(() => buildSecureStoreKeys('with/slash')).toThrow(/appId must match/);
    expect(() => buildSecureStoreKeys('')).toThrow(/appId must match/);
  });
});

describe('OidcSessionRN — constructor validation', () => {
  it('throws when store is missing', () => {
    expect(() => new OidcSessionRN()).toThrow(/store required/);
  });
  it('throws when store is missing required methods', () => {
    expect(() => new OidcSessionRN({ store: {} })).toThrow(/getItemAsync/);
    expect(() => new OidcSessionRN({ store: { getItemAsync: () => null } })).toThrow(/setItemAsync/);
    expect(() => new OidcSessionRN({ store: {
      getItemAsync: async () => null, setItemAsync: async () => {},
    } })).toThrow(/deleteItemAsync/);
  });
  it('builds with a valid store', () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    expect(sess).toBeInstanceOf(OidcSessionRN);
    expect(sess.storageKeys.ACCESS_TOKEN).toBe('folio-oidc-access-token');
  });
});

describe('OidcSessionRN — adoptTokens + isAuthenticated', () => {
  it('adopts a fresh token set and persists', async () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'pinboard' });
    await sess.adoptTokens({
      accessToken: 'A', refreshToken: 'R', idToken: 'I',
      expiresIn: 60, issuer: 'https://idp', webid: 'https://anne/me',
    });
    expect(sess.isAuthenticated()).toBe(true);
    expect(sess.webid).toBe('https://anne/me');
    expect(s._peek()['pinboard-oidc-access-token']).toBe('A');
    expect(s._peek()['pinboard-oidc-issuer']).toBe('https://idp');
  });

  it('rejects bad token sets', async () => {
    const sess = new OidcSessionRN({ store: buildStore() });
    await expect(sess.adoptTokens(null)).rejects.toThrow(/tokens object required/);
    await expect(sess.adoptTokens({})).rejects.toThrow(/accessToken required/);
  });

  it('treats a past expiresAt as expired', async () => {
    const sess = new OidcSessionRN({ store: buildStore(), appId: 'folio' });
    await sess.adoptTokens({ accessToken: 'A', expiresAt: Date.now() - 1000 });
    expect(sess.isAuthenticated()).toBe(false);
  });
});

describe('OidcSessionRN — restoreFromVault', () => {
  it('returns false when nothing is stored', async () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    expect(await sess.restoreFromVault()).toBe(false);
  });

  it('returns true when a valid access-token is in the vault', async () => {
    const future = String(Date.now() + 60_000);
    const s = buildStore({
      'folio-oidc-access-token': 'A',
      'folio-oidc-issuer':       'https://idp',
      'folio-oidc-expires-at':   future,
      'folio-oidc-webid':        'https://anne/me',
    });
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    expect(await sess.restoreFromVault()).toBe(true);
    expect(sess.webid).toBe('https://anne/me');
  });

  it('returns false when only refresh-token is in vault but access-token gone', async () => {
    const s = buildStore({
      'folio-oidc-refresh-token': 'R',
    });
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    // refresh available → isAuthenticated still false (access-token missing)
    expect(await sess.restoreFromVault()).toBe(false);
  });
});

describe('OidcSessionRN — getAuthenticatedFetch', () => {
  it('attaches the bearer token to outgoing requests', async () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    await sess.adoptTokens({ accessToken: 'A', expiresIn: 60 });
    const seenHeaders = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init) => {
      seenHeaders.push(init.headers.get('Authorization'));
      return new Response('ok', { status: 200 });
    });
    try {
      const f = sess.getAuthenticatedFetch();
      await f('https://x', {});
      expect(seenHeaders[0]).toBe('Bearer A');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('throws when no token AND no refresh token are present', () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'folio' });
    expect(() => sess.getAuthenticatedFetch()).toThrow(/not authenticated/);
  });
});

describe('OidcSessionRN — logout', () => {
  it('clears in-memory state and removes vault entries', async () => {
    const s = buildStore();
    const sess = new OidcSessionRN({ store: s, appId: 'pinboard' });
    await sess.adoptTokens({ accessToken: 'A', issuer: 'https://idp', expiresIn: 60 });
    await sess.logout();
    expect(sess.isAuthenticated()).toBe(false);
    expect(sess.webid).toBe(null);
    expect(s._peek()).toEqual({});
  });
});
