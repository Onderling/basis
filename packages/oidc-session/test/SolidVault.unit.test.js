/**
 * SolidVault — unit tests with a mocked Inrupt Session.
 *
 * Covers:
 *   - login flow stores tokens in the supplied vault
 *   - getAuthenticatedFetch returns a session-bound fetch
 *   - automatic refresh near expiry
 *   - manual refresh emits 'auth-state'
 *   - logout clears tokens + vault
 *   - expired-without-refresh ⇒ isAuthenticated() === false
 *   - persistence across processes: a fresh SolidVault sharing a vault
 *     can re-login from the stored refresh token without explicit creds
 *
 * We don't reach Inrupt internals; we inject a fake `Session` constructor
 * via the `_setSessionFactory` test seam.
 *
 * Tests import `VaultMemory` from `@onderling/core` to exercise the
 * substrate against the real consumer-grade vault.  The substrate itself
 * only requires a Vault-shaped object (`get`/`set`/`delete`/`list`) — it
 * has no runtime dep on core.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { VaultMemory } from '@onderling/vault';
import { SolidVault, _setSessionFactory } from '../src/SolidVault.js';

const WEBID  = 'https://alice.example/profile/card#me';
const ISSUER = 'https://login.example/';

/* ────────────────────────────────────────────────────────────────────────── */
/** Fake Session that mimics enough of @inrupt/solid-client-authn-node Session. */
class FakeSession {
  constructor(initial = {}) {
    this.events = new EventEmitter();
    this.info = {
      isLoggedIn:     false,
      sessionId:      `sid-${Math.random().toString(36).slice(2)}`,
      webId:          undefined,
      expirationDate: undefined,
    };
    this.accessToken  = null;
    this.refreshToken = null;
    this.idToken      = null;
    this.fetchCalls   = [];

    // Test-only: spool of token sets to emit on each successive login.
    this._tokenSpool  = initial._tokenSpool ?? [{
      accessToken:  'access-1',
      refreshToken: 'refresh-1',
      idToken:      'id-1',
      // expiresAt as seconds-since-epoch (Inrupt convention)
      expiresAt:    Math.floor(Date.now() / 1000) + 3600,
    }];
  }

  async login(opts) {
    const next = this._tokenSpool.shift() ?? {
      accessToken:  'access-X',
      refreshToken: 'refresh-X',
      idToken:      'id-X',
      expiresAt:    Math.floor(Date.now() / 1000) + 3600,
    };
    this.info.isLoggedIn     = true;
    this.info.webId          = opts?.webId ?? WEBID;
    this.info.expirationDate = next.expiresAt < 1e12 ? next.expiresAt * 1000 : next.expiresAt;
    this.accessToken  = next.accessToken;
    this.refreshToken = next.refreshToken;
    this.idToken      = next.idToken;

    // Emit NEW_TOKENS like the real Inrupt session does after login.
    this.events.emit('newTokens', next);
  }

  async logout(_opts) {
    this.info.isLoggedIn = false;
    this.accessToken     = null;
    this.refreshToken    = null;
    this.idToken         = null;
    this.events.emit('logout');
  }

  async fetch(input, init) {
    this.fetchCalls.push({ input, init });
    // Return a stub Response.
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
}

function fakeFactory(initial = {}) {
  return () => new FakeSession(initial);
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — construction', () => {
  afterEach(() => { _setSessionFactory(null); });

  it('throws if webid is missing', () => {
    expect(() => new SolidVault({})).toThrow(/webid/i);
  });

  it('exposes webid / oidcIssuer / redirectUrl getters', () => {
    const sv = new SolidVault({
      webid: WEBID,
      oidcIssuer: ISSUER,
      redirectUrl: 'https://app.example/cb',
    });
    expect(sv.webid).toBe(WEBID);
    expect(sv.oidcIssuer).toBe(ISSUER);
    expect(sv.redirectUrl).toBe('https://app.example/cb');
  });

  it('defaults to an in-memory vault when none is supplied', async () => {
    _setSessionFactory(fakeFactory());
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER });
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(sv.isAuthenticated()).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — login', () => {
  let vault;
  beforeEach(() => { vault = new VaultMemory(); _setSessionFactory(fakeFactory()); });
  afterEach(()  => { _setSessionFactory(null); });

  it('persists tokens under solid-oidc:<webid>:* keys', async () => {
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c-id', clientSecret: 'c-sec' });

    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBe('access-1');
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBe('refresh-1');
    expect(await vault.get(`solid-oidc:${WEBID}:id_token`)).toBe('id-1');
    const expiresAt = Number(await vault.get(`solid-oidc:${WEBID}:expires_at`));
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(await vault.get(`solid-oidc:${WEBID}:client_id`)).toBe('c-id');
    expect(await vault.get(`solid-oidc:${WEBID}:client_secret`)).toBe('c-sec');
    expect(await vault.get(`solid-oidc:${WEBID}:oidc_issuer`)).toBe(ISSUER);
  });

  it('isAuthenticated() === true after a fresh login', async () => {
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    expect(sv.isAuthenticated()).toBe(false);
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(sv.isAuthenticated()).toBe(true);
  });

  it('emits auth-state=authenticated on successful login', async () => {
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    const events = [];
    sv.on('auth-state', s => events.push(s));
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(events).toContain('authenticated');
  });

  it('throws INVALID_ARGUMENT when oidcIssuer cannot be determined', async () => {
    const sv = new SolidVault({ webid: WEBID, vault });
    await expect(sv.login({ clientId: 'c', clientSecret: 's' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws INVALID_ARGUMENT when clientId / clientSecret missing', async () => {
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await expect(sv.login({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — getAuthenticatedFetch', () => {
  let vault, sv;
  beforeEach(async () => {
    vault = new VaultMemory();
    _setSessionFactory(fakeFactory());
    sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });
  });
  afterEach(() => { _setSessionFactory(null); });

  it('returns a callable fetch that delegates to the session', async () => {
    const fetchFn = sv.getAuthenticatedFetch();
    const res = await fetchFn('https://pod.example/resource');
    expect(res.status).toBe(200);
  });

  it('does not refresh when the access token is far from expiry', async () => {
    const fetchFn = sv.getAuthenticatedFetch();
    // Spy on emitted auth-state events
    const events = [];
    sv.on('auth-state', s => events.push(s));
    await fetchFn('https://pod.example/resource');
    expect(events).not.toContain('refreshed');
  });

  it('throws UNAUTHENTICATED when no session exists and vault has no creds', async () => {
    // Fresh SolidVault, fresh empty vault.
    const fresh = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault: new VaultMemory() });
    const fetchFn = fresh.getAuthenticatedFetch();
    await expect(fetchFn('https://pod.example/x'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — refresh', () => {
  afterEach(() => { _setSessionFactory(null); });

  it('emits auth-state=refreshed on successful refresh', async () => {
    const vault = new VaultMemory();
    _setSessionFactory(fakeFactory());
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });

    const events = [];
    sv.on('auth-state', s => events.push(s));
    await sv.refresh();
    expect(events).toContain('refreshed');
  });

  it('persists the new refresh token after refresh', async () => {
    const vault = new VaultMemory();
    // Spool: first login returns refresh-1, refresh returns refresh-2.
    let calls = 0;
    _setSessionFactory(() => new FakeSession({
      _tokenSpool: [
        { accessToken: 'a-1', refreshToken: 'r-1', idToken: 'i-1', expiresAt: Math.floor(Date.now()/1000) + 3600 },
        { accessToken: 'a-2', refreshToken: 'r-2', idToken: 'i-2', expiresAt: Math.floor(Date.now()/1000) + 3600 },
      ],
    }));
    void calls;

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBe('r-1');

    await sv.refresh();
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBe('r-2');
    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBe('a-2');
  });

  // A client-credentials session is issued NO refresh token — the grant itself is the credential.
  // This is the shape every pod in this repo logs in with, and `refresh()` used to throw
  // NO_REFRESH_TOKEN for it. Because `getAuthenticatedFetch` swallows a failed pre-emptive refresh,
  // the symptom was not an error but a pod session that quietly started 401ing at token expiry.
  it('renews a CLIENT-CREDENTIALS session, which carries no refresh token', async () => {
    const vault = new VaultMemory();
    const noRefreshToken = (accessToken) => ({
      accessToken, refreshToken: undefined, idToken: 'i', expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const logins = [];
    // ONE spool across sessions: the renewal builds a fresh session (a logged-in Inrupt session
    // will not re-login in place), so a per-session spool would hand out the same first token twice
    // and the assertion below would pass without anything having been renewed.
    const spool = [noRefreshToken('cc-1'), noRefreshToken('cc-2')];
    _setSessionFactory(() => {
      const fs = new FakeSession({ _tokenSpool: spool });
      const inner = fs.login.bind(fs);
      fs.login = async (opts) => { logins.push(opts); return inner(opts); };
      return fs;
    });

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBeFalsy();

    const events = [];
    sv.on('auth-state', (st) => events.push(st));
    await expect(sv.refresh()).resolves.toBeUndefined();
    expect(events).toContain('refreshed');
    expect(events).not.toContain('expired');
    expect(sv.isAuthenticated()).toBe(true);

    // It re-presented the credentials rather than a refresh token — that IS the renewal.
    const renewal = logins.at(-1);
    expect(renewal.clientId).toBe('c');
    expect(renewal.clientSecret).toBe('s');
    expect(renewal.refreshToken).toBeUndefined();
    // …and the new access token replaced the old one.
    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBe('cc-2');
  });

  it('automatic refresh kicks in when the token is within REFRESH_LEEWAY_MS of expiry', async () => {
    const vault = new VaultMemory();
    // First "login" returns a token that expires *now*, forcing a refresh.
    const nowSec = Math.floor(Date.now() / 1000);
    _setSessionFactory(() => new FakeSession({
      _tokenSpool: [
        { accessToken: 'a-1', refreshToken: 'r-1', idToken: 'i-1', expiresAt: nowSec + 1 },     // expires very soon
        { accessToken: 'a-2', refreshToken: 'r-2', idToken: 'i-2', expiresAt: nowSec + 3600 }, // refreshed
      ],
    }));

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });

    const events = [];
    sv.on('auth-state', s => events.push(s));

    const fetchFn = sv.getAuthenticatedFetch();
    await fetchFn('https://pod.example/x');

    expect(events).toContain('refreshed');
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBe('r-2');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — logout', () => {
  afterEach(() => { _setSessionFactory(null); });

  it('clears all solid-oidc:<webid>:* entries', async () => {
    const vault = new VaultMemory();
    _setSessionFactory(fakeFactory());
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });

    // Sanity: tokens exist
    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBeTruthy();

    await sv.logout();

    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBe(null);
    expect(await vault.get(`solid-oidc:${WEBID}:refresh_token`)).toBe(null);
    expect(await vault.get(`solid-oidc:${WEBID}:client_id`)).toBe(null);
    expect(sv.isAuthenticated()).toBe(false);
  });

  it('emits auth-state=unauthenticated', async () => {
    const vault = new VaultMemory();
    _setSessionFactory(fakeFactory());
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });

    const events = [];
    sv.on('auth-state', s => events.push(s));
    await sv.logout();
    expect(events).toContain('unauthenticated');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — expiry semantics', () => {
  afterEach(() => { _setSessionFactory(null); });

  it('isAuthenticated() returns false once the access token has expired', async () => {
    const vault = new VaultMemory();
    const nowSec = Math.floor(Date.now() / 1000);
    _setSessionFactory(() => new FakeSession({
      _tokenSpool: [
        // Token "expired" 1s ago.
        { accessToken: 'a-1', refreshToken: 'r-1', idToken: 'i-1', expiresAt: nowSec - 1 },
      ],
    }));

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv.login({ clientId: 'c', clientSecret: 's' });
    expect(sv.isAuthenticated()).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — persistence across instances', () => {
  afterEach(() => { _setSessionFactory(null); });

  it('a fresh SolidVault sharing a vault re-logs in from stored refresh token', async () => {
    const vault = new VaultMemory();
    // Two separate fake-session factories so each SolidVault gets its own.
    let factoryCalls = 0;
    _setSessionFactory(() => {
      factoryCalls++;
      return new FakeSession();
    });

    // First instance logs in normally with explicit creds.
    const sv1 = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv1.login({ clientId: 'c', clientSecret: 's' });

    // Second instance — no creds passed.  It must pull them from the vault.
    const sv2 = new SolidVault({ webid: WEBID, vault });
    await sv2.login({});  // no opts at all

    expect(sv2.isAuthenticated()).toBe(true);
    // Inrupt session factory was invoked twice — once per SolidVault.
    expect(factoryCalls).toBe(2);
  });

  it('refresh() on a fresh SolidVault works using only stored refresh token', async () => {
    const vault = new VaultMemory();
    _setSessionFactory(() => new FakeSession({
      _tokenSpool: [
        { accessToken: 'a-1', refreshToken: 'r-1', idToken: 'i-1', expiresAt: Math.floor(Date.now()/1000) + 3600 },
      ],
    }));
    const sv1 = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault });
    await sv1.login({ clientId: 'c', clientSecret: 's' });

    // New instance from the same vault.
    _setSessionFactory(() => new FakeSession({
      _tokenSpool: [
        { accessToken: 'a-2', refreshToken: 'r-2', idToken: 'i-2', expiresAt: Math.floor(Date.now()/1000) + 3600 },
      ],
    }));
    const sv2 = new SolidVault({ webid: WEBID, vault });
    await sv2.refresh();
    expect(sv2.isAuthenticated()).toBe(true);
    expect(await vault.get(`solid-oidc:${WEBID}:access_token`)).toBe('a-2');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('SolidVault — podRoot', () => {
  afterEach(() => { _setSessionFactory(null); globalThis.fetch = undefined; });

  it('derives podRoot from WebID profile pim:storage triple', async () => {
    // Fake fetch returns Turtle with pim:storage.
    globalThis.fetch = async (url) => {
      if (String(url) === WEBID) {
        const body = `
          @prefix pim: <http://www.w3.org/ns/pim/space#> .
          <${WEBID}> pim:storage <https://alice.example/data/> .
        `;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/turtle' } });
      }
      return new Response('', { status: 404 });
    };

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault: new VaultMemory() });
    const root = await sv.getPodRoot();
    expect(root).toBe('https://alice.example/data/');
    expect(sv.podRoot).toBe('https://alice.example/data/');
  });

  it('falls back to webid origin when no pim:storage triple', async () => {
    globalThis.fetch = async () =>
      new Response('@prefix foaf: <http://xmlns.com/foaf/0.1/> .', { status: 200, headers: { 'content-type': 'text/turtle' } });

    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault: new VaultMemory() });
    const root = await sv.getPodRoot();
    expect(root).toBe('https://alice.example/');
  });

  it('falls back to webid origin when fetch fails entirely', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    const sv = new SolidVault({ webid: WEBID, oidcIssuer: ISSUER, vault: new VaultMemory() });
    const root = await sv.getPodRoot();
    expect(root).toBe('https://alice.example/');
  });
});
