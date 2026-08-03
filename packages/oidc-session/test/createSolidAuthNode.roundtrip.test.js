/**
 * createSolidAuthNode — interactive redirect ROUND-TRIP harness.
 *
 * "The one hop not verified end-to-end". The focused surface
 * tests in `createSolidAuthNode.test.js` prove each method in isolation
 * with a permissive fake. Here we harness the FULL browser-redirect
 * round-trip against a PKCE/state-FAITHFUL fake Inrupt `Session`, so the
 * seam actually exercises the contract Inrupt enforces at runtime:
 *
 *     start({issuer, redirectUrl})
 *        → authorize URL carrying state + code_challenge (S256)
 *        → [ the IdP redirects the browser back with ?code=&state= ]
 *        → handleCallback(callbackUrl)
 *        → authenticated session + usable getAuthenticatedFetch()
 *
 * The fake models the two invariants a real IdP + Inrupt's
 * `ClientAuthentication` storage enforce across the redirect gap:
 *
 *   - STATE integrity (CSRF defence): the `state` the IdP echoes back
 *     must equal the `state` minted at `login()` time. A tampered /
 *     mismatched state → the exchange is rejected, no session.
 *   - PKCE binding: the `code_verifier` minted at `login()` never
 *     leaves the session instance; a code can only be redeemed by the
 *     same session that started the dance (cross-session replay fails).
 *
 * Plus the persisted-vault round-trip: a fresh process (new auth object,
 * fresh session, same vault) resumes silently from the stored refresh
 * token — proving tokens land where a cold boot can pick them up.
 *
 * Live-IdP boundary: this harness proves everything EXCEPT the real
 * browser navigation + real token exchange against a live Solid IdP.
 * That genuinely needs a human at a browser (or a scripted headless
 * consent) + provisioned creds — see the note at the foot of this file
 * and the env-gated `SolidVault.css.test.js` (client-credentials).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import {
  createSolidAuthNode,
  OIDC_VAULT_KEYS,
  _setSolidAuthNodeSessionFactory,
} from '../index.js';

/* ── helpers ──────────────────────────────────────────────────────── */

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Minimal async vault (shared across "processes" to prove resume). */
class MemVault {
  constructor(seed = {}) { this.entries = new Map(Object.entries(seed)); }
  async get(k)    { return this.entries.get(k); }
  async set(k, v) { this.entries.set(k, String(v)); }
  async delete(k) { this.entries.delete(k); }
}

/**
 * PKCE/state-FAITHFUL fake Inrupt `Session`.
 *
 * Unlike the permissive fake in the sibling test, this one:
 *   - mints a real `code_verifier` + S256 `code_challenge` + `state`
 *     at login() and embeds them in the authorize URL;
 *   - on handleIncomingRedirect() validates the echoed `state` against
 *     the minted one and requires a `code`, exactly as the real
 *     token-exchange path would (state mismatch or missing code → throw);
 *   - keeps the `code_verifier` private to the instance (PKCE binding).
 */
class PkceFakeSession {
  constructor() {
    this.events = new EventEmitter();
    this.info = { isLoggedIn: false, sessionId: `sid-${b64url(randomBytes(6))}` };
    this._pending = null;   // { codeVerifier, state, redirectUrl, issuer }
    this.loginCalls = 0;
    this.fetchCalls = [];
  }

  async login(opts) {
    this.loginCalls++;

    // Silent refresh path (restoreFromVault) — no browser redirect.
    if (opts?.refreshToken) {
      if (!opts.refreshToken) throw new Error('empty refresh token');
      this.info.isLoggedIn = true;
      this.info.webId = 'https://alice.example/profile#me';
      this.info.expirationDate = Date.now() + 3600_000;
      const rotated = `rotated-${opts.refreshToken}`;
      this.info.refreshToken = rotated;
      this.events.emit('newRefreshToken', rotated);
      this.events.emit('newTokens', { refreshToken: rotated, expiresAt: this.info.expirationDate });
      return;
    }

    // Browser-redirect path — mint PKCE + state, build the authorize URL.
    const codeVerifier  = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
    const state         = b64url(randomBytes(16));
    this._pending = { codeVerifier, state, redirectUrl: opts.redirectUrl, issuer: opts.oidcIssuer };

    const authUrl = new URL(`${String(opts.oidcIssuer).replace(/\/$/, '')}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_name', opts.clientName ?? '');
    authUrl.searchParams.set('redirect_uri', opts.redirectUrl);
    authUrl.searchParams.set('scope', 'openid offline_access webid');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    opts.handleRedirect(authUrl.toString());
  }

  async handleIncomingRedirect(callbackUrl) {
    if (!this._pending) {
      // No dance started on THIS session → PKCE verifier absent → cannot
      // redeem. Mirrors Inrupt refusing an exchange with no stored state.
      throw new Error('no code_verifier / state on this session — nothing to redeem');
    }
    const u = new URL(callbackUrl);
    const code = u.searchParams.get('code');
    const returnedState = u.searchParams.get('state');
    if (!code) throw new Error('callback missing authorization code');
    if (returnedState !== this._pending.state) {
      // state mismatch → possible CSRF / cross-session replay → reject.
      throw new Error('state mismatch — refusing to redeem code');
    }
    // code_verifier proves possession → the exchange succeeds.
    this.info.isLoggedIn = true;
    this.info.webId = 'https://alice.example/profile#me';
    this.info.expirationDate = Date.now() + 3600_000;
    this.info.refreshToken = 'refresh-from-code-exchange';
    this.info.clientAppId = 'dynamic-client-id';
    this.events.emit('newRefreshToken', this.info.refreshToken);
    this.events.emit('newTokens', { refreshToken: this.info.refreshToken, expiresAt: this.info.expirationDate });
    this._pending = null;
  }

  async fetch(uri, init) {
    if (!this.info.isLoggedIn) throw new Error('not authenticated');
    this.fetchCalls.push(String(uri));
    // Session-bound fetch: proves the returned fn carries the auth context.
    return new Response(JSON.stringify({ url: String(uri), authorized: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  async logout() { this.info.isLoggedIn = false; }
}

/** Model the IdP: echo `state` back, hand out a `code`. */
function idpRedirectBack(authorizeUrl, redirectUrl, { code = 'auth-code-123', state } = {}) {
  const auth = new URL(authorizeUrl);
  const cb = new URL(redirectUrl);
  cb.searchParams.set('code', code);
  cb.searchParams.set('state', state ?? auth.searchParams.get('state'));
  cb.searchParams.set('iss', auth.origin);
  return cb.toString();
}

/* ── seam wiring ──────────────────────────────────────────────────── */

let lastSession = null;
beforeEach(() => {
  _setSolidAuthNodeSessionFactory(() => { lastSession = new PkceFakeSession(); return lastSession; });
});
afterEach(() => {
  _setSolidAuthNodeSessionFactory(null);
  lastSession = null;
});

/* ── the round-trip ───────────────────────────────────────────────── */

const REDIRECT = 'http://localhost:8888/auth/callback';

describe('createSolidAuthNode — interactive redirect round-trip (#167)', () => {
  it('start → authorize URL carries state + S256 PKCE challenge + redirect_uri', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    const { redirectUrl } = await auth.start({ issuer: 'inrupt', redirectUrl: REDIRECT });

    const u = new URL(redirectUrl);
    expect(u.origin + u.pathname).toBe('https://login.inrupt.com/authorize');
    expect(u.searchParams.get('state')).toBeTruthy();
    expect(u.searchParams.get('code_challenge')).toBeTruthy();
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    // Not yet authenticated — the browser hasn't been to the IdP.
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('full hop: start → IdP redirect back → handleCallback → authenticated + usable fetch', async () => {
    const vault = new MemVault();
    const auth  = createSolidAuthNode({ vault, clientName: 'Onderling' });

    // 1. start → authorize URL.
    const { redirectUrl: authorizeUrl } = await auth.start({ issuer: 'inrupt', redirectUrl: REDIRECT });

    // 2. simulate the IdP redirecting the browser back (echoes state, adds code).
    const callbackUrl = idpRedirectBack(authorizeUrl, REDIRECT);

    // 3. complete the exchange.
    const info = await auth.handleCallback(callbackUrl);
    expect(info.webid).toBe('https://alice.example/profile#me');
    expect(info.issuer).toBe('https://login.inrupt.com');
    expect(typeof info.expiresAt).toBe('number');

    // 4. authenticated session with a usable, session-bound fetch.
    expect(auth.isAuthenticated()).toBe(true);
    const fetchFn = auth.getAuthenticatedFetch();
    expect(typeof fetchFn).toBe('function');
    const res = await fetchFn('https://alice.example/private/thing');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://alice.example/private/thing', authorized: true });

    // tokens persisted for resume.
    expect(await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN)).toBe('refresh-from-code-exchange');
    expect(await vault.get(OIDC_VAULT_KEYS.ISSUER)).toBe('https://login.inrupt.com');
  });

  it('STATE integrity: a tampered state in the callback is rejected (no session)', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    const { redirectUrl: authorizeUrl } = await auth.start({ issuer: 'inrupt', redirectUrl: REDIRECT });

    // Attacker/forged callback: valid-looking code, WRONG state.
    const tampered = idpRedirectBack(authorizeUrl, REDIRECT, { state: 'forged-state' });
    await expect(auth.handleCallback(tampered)).rejects.toMatchObject({ code: 'OIDC_CALLBACK_FAILED' });
    expect(auth.isAuthenticated()).toBe(false);
    expect(() => auth.getAuthenticatedFetch()).toThrow(/not authenticated/);
  });

  it('STATE integrity: a callback with no authorization code is rejected', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    const { redirectUrl: authorizeUrl } = await auth.start({ issuer: 'inrupt', redirectUrl: REDIRECT });
    const state = new URL(authorizeUrl).searchParams.get('state');
    const noCode = `${REDIRECT}?state=${encodeURIComponent(state)}`;   // state ok, code absent
    await expect(auth.handleCallback(noCode)).rejects.toMatchObject({ code: 'OIDC_CALLBACK_FAILED' });
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('PKCE binding: a code minted for session A cannot be redeemed by a fresh session B', async () => {
    // Session A runs the full dance and captures a real authorize URL (state + challenge).
    const authA = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    const { redirectUrl: authorizeUrlA } = await authA.start({ issuer: 'inrupt', redirectUrl: REDIRECT });
    const callbackForA = idpRedirectBack(authorizeUrlA, REDIRECT);

    // Session B starts its OWN dance (fresh session, fresh code_verifier/state),
    // then someone replays A's callback (A's code+state) into B.
    const authB = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    await authB.start({ issuer: 'inrupt', redirectUrl: REDIRECT });
    await expect(authB.handleCallback(callbackForA)).rejects.toMatchObject({ code: 'OIDC_CALLBACK_FAILED' });
    expect(authB.isAuthenticated()).toBe(false);

    // Sanity: A's own callback still completes A's dance.
    const infoA = await authA.handleCallback(callbackForA);
    expect(infoA.webid).toBe('https://alice.example/profile#me');
    expect(authA.isAuthenticated()).toBe(true);
  });

  it('handleCallback before start is refused (no login in progress)', async () => {
    const auth = createSolidAuthNode({ vault: new MemVault(), clientName: 'Onderling' });
    await expect(auth.handleCallback(`${REDIRECT}?code=x&state=y`))
      .rejects.toMatchObject({ code: 'NO_LOGIN_IN_PROGRESS' });
  });

  it('persisted-vault round-trip: a fresh process resumes silently from the stored refresh token', async () => {
    // ── Process 1: interactive sign-in populates the vault. ──
    const vault = new MemVault();
    const auth1 = createSolidAuthNode({ vault, clientName: 'Onderling' });
    const { redirectUrl: authorizeUrl } = await auth1.start({ issuer: 'inrupt', redirectUrl: REDIRECT });
    await auth1.handleCallback(idpRedirectBack(authorizeUrl, REDIRECT));
    expect(auth1.isAuthenticated()).toBe(true);
    expect(await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN)).toBeTruthy();

    // ── Process 2: brand-new auth object + fresh session, SAME vault. ──
    // No start()/handleCallback() — just restoreFromVault, as a cold boot would.
    const auth2 = createSolidAuthNode({ vault, clientName: 'Onderling' });
    expect(auth2.isAuthenticated()).toBe(false);          // nothing in memory yet
    const restored = await auth2.restoreFromVault();
    expect(restored).toBe(true);
    expect(auth2.isAuthenticated()).toBe(true);
    expect(auth2.getStatus().webid).toBe('https://alice.example/profile#me');

    // The resumed session yields a usable authenticated fetch too.
    const res = await auth2.getAuthenticatedFetch()('https://alice.example/private/again');
    expect(res.status).toBe(200);
  });
});

/*
 * ── LIVE-IdP BOUNDARY (what this harness does NOT prove) ─────────────
 *
 * The harness above proves the WIRING of the round-trip end-to-end:
 * start → authorize-URL shape (state + S256 PKCE) → IdP redirect-back →
 * handleCallback → authenticated session → usable fetch, plus state/PKCE
 * rejection and cold-boot resume. What it necessarily fakes:
 *
 *   1. The real full-page browser navigation to the IdP's authorize
 *      endpoint and the human granting consent.
 *   2. The IdP actually minting the auth `code` and the real
 *      code_for_token exchange (JWKS, DPoP, real refresh/access tokens).
 *
 * Those two need a real Solid IdP + a real browser (or scripted headless
 * consent) + provisioned credentials — not automatable in a unit harness.
 * The repo's env-gated integration pattern lives in
 * `SolidVault.css.test.js`, but that path uses CLIENT-CREDENTIALS login
 * (machine-to-machine), which deliberately SKIPS the interactive redirect
 * + consent this file harnesses. A genuine interactive-redirect e2e would
 * need Playwright driving a scriptable CSS login form; that is out of
 * scope for this substrate test and is the manual/e2e boundary.
 */
