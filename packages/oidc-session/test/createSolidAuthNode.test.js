/**
 * createSolidAuthNode — focused substrate-level tests.
 *
 * The full HTTP-level integration coverage lives in
 * `apps/folio/test/auth.test.js` (which migrates to this substrate in
 * Phase 52.15.3). Here we just verify the SolidAuth-shaped surface +
 * the `resolveIssuer` integration.
 *
 * Phase 52.15.2 (2026-05-14).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createSolidAuthNode,
  OIDC_VAULT_KEYS,
  _setSolidAuthNodeSessionFactory,
} from '../index.js';

/** Minimal vault. */
class MemVault {
  constructor(seed = {}) { this.entries = new Map(Object.entries(seed)); }
  async get(k)    { return this.entries.get(k); }
  async set(k, v) { this.entries.set(k, String(v)); }
  async delete(k) { this.entries.delete(k); }
}

/** Fake Inrupt Session — captures login/callback/fetch behaviour. */
class FakeSession {
  constructor() {
    this.events = new EventEmitter();
    this.info = { isLoggedIn: false, sessionId: 'sid-1', webId: undefined, expirationDate: undefined };
    this._issuer = null;
    this._redirectUrl = null;
    this._loginCalls = 0;
  }

  async login(opts) {
    this._loginCalls++;
    this._issuer = opts?.oidcIssuer ?? null;
    this._redirectUrl = opts?.redirectUrl ?? null;
    // Refresh-token path (restoreFromVault) — no handleRedirect.
    if (opts?.refreshToken) {
      this.info.isLoggedIn = true;
      this.info.webId = 'https://alice.example/profile#me';
      this.info.expirationDate = Date.now() + 3600_000;
      this.events.emit('newTokens', { refreshToken: opts.refreshToken, expiresAt: this.info.expirationDate });
      return;
    }
    // Browser-redirect path — capture authorize URL.
    if (typeof opts?.handleRedirect === 'function') {
      opts.handleRedirect(`${opts.oidcIssuer}/authorize?client_id=test`);
    }
  }

  async handleIncomingRedirect(_callbackUrl) {
    this.info.isLoggedIn = true;
    this.info.webId = 'https://alice.example/profile#me';
    this.info.expirationDate = Date.now() + 3600_000;
    this.info.refreshToken = 'fresh-refresh-token';
    this.info.clientAppId = 'dynamic-client-id';
    this.events.emit('newTokens', { refreshToken: 'fresh-refresh-token', expiresAt: this.info.expirationDate });
  }

  async fetch(_uri, _init) { return new Response('ok'); }

  async logout() { this.info.isLoggedIn = false; }
}

beforeEach(() => {
  _setSolidAuthNodeSessionFactory(() => new FakeSession());
});

afterEach(() => {
  _setSolidAuthNodeSessionFactory(null);
});

describe('createSolidAuthNode — construction', () => {
  it('throws without a vault', () => {
    expect(() => createSolidAuthNode({ clientName: 'Test' })).toThrow(/vault/);
  });

  it('throws when vault is missing methods', () => {
    expect(() => createSolidAuthNode({ vault: {}, clientName: 'Test' })).toThrow(/get \/ set \/ delete/);
  });

  it('throws without a clientName', () => {
    expect(() => createSolidAuthNode({ vault: new MemVault() })).toThrow(/clientName/);
  });
});

describe('createSolidAuthNode — start()', () => {
  it('returns the authorize URL', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    const { redirectUrl } = await auth.start({
      issuer: 'https://login.inrupt.com',
      redirectUrl: 'http://localhost:8888/auth/callback',
    });
    expect(redirectUrl).toContain('https://login.inrupt.com/authorize');
  });

  it('resolves a known issuer id', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    const { redirectUrl } = await auth.start({
      issuer: 'inrupt',
      redirectUrl: 'http://localhost:8888/auth/callback',
    });
    expect(redirectUrl).toContain('https://login.inrupt.com/authorize');
  });

  it('resolves a custom URL', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    const { redirectUrl } = await auth.start({
      issuer: 'https://my-css.example',
      redirectUrl: 'http://localhost:8888/auth/callback',
    });
    expect(redirectUrl).toContain('https://my-css.example/authorize');
  });

  it('throws on unknown issuer (malformed string, not a URL, not a known id)', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await expect(
      auth.start({ issuer: 'not-an-id-not-a-url', redirectUrl: 'http://localhost' }),
    ).rejects.toThrow(/unknown issuer/);
  });

  it('throws when issuer / redirectUrl missing', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await expect(auth.start({ redirectUrl: 'http://localhost' })).rejects.toThrow(/issuer is required/);
    await expect(auth.start({ issuer: 'inrupt' })).rejects.toThrow(/redirectUrl is required/);
  });
});

describe('createSolidAuthNode — handleCallback()', () => {
  it('completes the dance + persists refresh token to vault', async () => {
    const vault = new MemVault();
    const auth  = createSolidAuthNode({ vault, clientName: 'Test' });
    await auth.start({ issuer: 'inrupt', redirectUrl: 'http://localhost/auth/callback' });
    const result = await auth.handleCallback('http://localhost/auth/callback?code=abc&state=xyz');
    expect(result.webid).toBe('https://alice.example/profile#me');
    expect(result.issuer).toBe('https://login.inrupt.com');
    expect(await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN)).toBe('fresh-refresh-token');
    expect(await vault.get(OIDC_VAULT_KEYS.ISSUER)).toBe('https://login.inrupt.com');
  });

  it('throws when no login is in progress', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await expect(auth.handleCallback('http://localhost/cb')).rejects.toThrow(/no login in progress/);
  });

  it('throws on empty callbackUrl', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await auth.start({ issuer: 'inrupt', redirectUrl: 'http://localhost/cb' });
    await expect(auth.handleCallback('')).rejects.toThrow(/callbackUrl is required/);
  });
});

describe('createSolidAuthNode — getStatus / isAuthenticated / getAuthenticatedFetch', () => {
  it('reports unauthenticated before sign-in', () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getStatus()).toEqual({ authenticated: false });
  });

  it('reports authenticated + webid + issuer + expiresAt after sign-in', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await auth.start({ issuer: 'inrupt', redirectUrl: 'http://localhost/cb' });
    await auth.handleCallback('http://localhost/cb?code=abc');
    expect(auth.isAuthenticated()).toBe(true);
    const status = auth.getStatus();
    expect(status.authenticated).toBe(true);
    expect(status.webid).toBe('https://alice.example/profile#me');
    expect(status.issuer).toBe('https://login.inrupt.com');
    expect(typeof status.expiresAt).toBe('number');
  });

  it('getAuthenticatedFetch throws when not authenticated', () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    expect(() => auth.getAuthenticatedFetch()).toThrow(/not authenticated/);
  });

  it('getAuthenticatedFetch returns the session-bound fetch when authenticated', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await auth.start({ issuer: 'inrupt', redirectUrl: 'http://localhost/cb' });
    await auth.handleCallback('http://localhost/cb?code=abc');
    const f = auth.getAuthenticatedFetch();
    expect(typeof f).toBe('function');
  });
});

describe('createSolidAuthNode — logout()', () => {
  it('clears in-memory session + vault entries', async () => {
    const vault = new MemVault();
    const auth  = createSolidAuthNode({ vault, clientName: 'Test' });
    await auth.start({ issuer: 'inrupt', redirectUrl: 'http://localhost/cb' });
    await auth.handleCallback('http://localhost/cb?code=abc');
    expect(auth.isAuthenticated()).toBe(true);

    await auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
    expect(await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN)).toBeUndefined();
    expect(await vault.get(OIDC_VAULT_KEYS.ISSUER)).toBeUndefined();
  });

  it('is idempotent', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    await auth.logout();
    await auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('createSolidAuthNode — restoreFromVault()', () => {
  it('returns false when nothing is stored', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Test' });
    const restored = await auth.restoreFromVault();
    expect(restored).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('refreshes silently when refresh token + issuer are stored', async () => {
    const vault = new MemVault({
      [OIDC_VAULT_KEYS.REFRESH_TOKEN]: 'stored-refresh',
      [OIDC_VAULT_KEYS.ISSUER]:        'https://login.inrupt.com',
    });
    const auth = createSolidAuthNode({ vault, clientName: 'Test' });
    const restored = await auth.restoreFromVault();
    expect(restored).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getStatus().webid).toBe('https://alice.example/profile#me');
  });

  it('warns via callback on failure (no throw)', async () => {
    _setSolidAuthNodeSessionFactory(() => {
      const s = new FakeSession();
      s.login = async () => { throw new Error('refresh rejected by IdP'); };
      return s;
    });
    const vault = new MemVault({
      [OIDC_VAULT_KEYS.REFRESH_TOKEN]: 'revoked-token',
      [OIDC_VAULT_KEYS.ISSUER]:        'https://login.inrupt.com',
    });
    const auth = createSolidAuthNode({ vault, clientName: 'Test' });
    const warnings = [];
    const restored = await auth.restoreFromVault({ onWarning: (m) => warnings.push(m) });
    expect(restored).toBe(false);
    expect(warnings[0]).toMatch(/refresh failed/);
  });
});
