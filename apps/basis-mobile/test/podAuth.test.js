/**
 * mobile podAuth adapter contract.
 *
 * Pins the shape that buildMobilePodAuth exposes — same surface
 * web's @onderling/oidc-session has, so localBuiltins' signin /
 * signout / whoami handlers work without per-surface branching.
 */
import { describe, it, expect } from 'vitest';
import { buildMobilePodAuth } from '../src/core/podAuth.js';

function fakeSession({ webid = null, authed = false, accessToken = null } = {}) {
  let cleared = false;
  return {
    isAuthenticated: () => authed && !cleared,
    get webid()        { return cleared ? null : webid; },
    get accessToken()  { return cleared ? null : accessToken; },
    get clientId()     { return null; },
    getStatus: () => ({ authenticated: authed && !cleared, webid: webid ?? undefined }),
    clear: async () => { cleared = true; },
  };
}

function fakeHook({ signInResult = { type: 'cancel' } } = {}) {
  const calls = [];
  return {
    ready: true,
    lastError: null,
    signIn: async (args) => {
      calls.push(args);
      return signInResult;
    },
    _calls: calls,
  };
}

describe('Bundle F P6 — buildMobilePodAuth', () => {
  it('exposes the podAuth interface localBuiltins.signin expects', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession(),
    });
    expect(typeof pa.startSignIn).toBe('function');
    expect(typeof pa.resolveIssuer).toBe('function');
    expect(typeof pa.getCurrentSession).toBe('function');
    expect(typeof pa.getRawSessionInfo).toBe('function');
    expect(typeof pa.signOut).toBe('function');
  });

  it('resolveIssuer returns the default issuer when input is empty', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession() });
    const r = pa.resolveIssuer('');
    expect(r).toBeTruthy();
    expect(typeof r.url).toBe('string');
  });

  it('resolveIssuer returns null for unknown input', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession() });
    expect(pa.resolveIssuer('totally-unknown-issuer')).toBeNull();
  });

  it('getCurrentSession returns null when session is not authenticated', () => {
    const pa = buildMobilePodAuth({ hook: fakeHook(), session: fakeSession({ authed: false }) });
    expect(pa.getCurrentSession()).toBeNull();
  });

  it('getCurrentSession returns {webid} when session has stored tokens', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession({
        webid: 'https://alice.solid.example/profile/card#me',
        authed: true,
        accessToken: 'tok',
      }),
    });
    expect(pa.getCurrentSession()).toEqual({
      webid: 'https://alice.solid.example/profile/card#me',
    });
  });

  it('getRawSessionInfo exposes the diagnostic shape /whoami needs', () => {
    const pa = buildMobilePodAuth({
      hook: fakeHook(),
      session: fakeSession({ accessToken: 'tok' }),
    });
    const info = pa.getRawSessionInfo();
    expect(info).toHaveProperty('sessionExists');
    expect(info).toHaveProperty('isLoggedIn');
    expect(info).toHaveProperty('webId');
  });

  it('signOut clears the underlying session', async () => {
    const session = fakeSession({ webid: 'https://x/#me', authed: true, accessToken: 'tok' });
    const pa = buildMobilePodAuth({ hook: fakeHook(), session });
    expect(pa.getCurrentSession()).toBeTruthy();
    await pa.signOut();
    expect(pa.getCurrentSession()).toBeNull();
  });

  // The hook's signIn() resolves to the FLAT token object that completeSignIn
  // returns ({accessToken, refreshToken, idToken, expiresAt, webid}) — verified
  // against packages/oidc-session-rn/hook.js (`return await pureCompleteSignIn(...)`).
  // The earlier `{type:'success', tokens:{…}}` fake mirrored a nested shape the
  // real hook never produced, so buildMobilePodAuth (correctly reading
  // `result.accessToken`) skipped adoption and this test failed. Fixed the fake
  // to the real shape; the adopt assertions are unchanged.
  it('startSignIn calls the hook and adopts tokens on success', async () => {
    const hook = fakeHook({
      signInResult: {
        accessToken: 'AT',
        refreshToken: 'RT',
        webid: 'https://alice.solid.example/profile/card#me',
      },
    });
    let adopted = null;
    const session = {
      ...fakeSession(),
      adoptTokens: async (tokens) => { adopted = tokens; },
    };
    const pa = buildMobilePodAuth({ hook, session });
    await pa.startSignIn({});
    expect(hook._calls).toHaveLength(1);
    expect(adopted?.accessToken).toBe('AT');
    expect(adopted?.webid).toBe('https://alice.solid.example/profile/card#me');
  });

  // The phone walk (2026-11-27): every provider the person picked ended at Inrupt, because the hook's issuer is its
  // PROP and the chosen one never reached it. A sign-in with another provider hands the hook that provider, waits until
  // the hook is ready FOR it (its own discovery and client), and only then signs in.
  it('a sign-in with another provider switches the hook to THAT provider and waits until it is ready for it', async () => {
    const LOCAL = 'http://127.0.0.1:3000';
    let state = { issuer: 'https://login.inrupt.com', ready: true };
    const signedInAt = [];
    const hookNow = () => ({ ...state, signIn: async () => { signedInAt.push(state.issuer); return { type: 'cancel' }; } });
    const chosen = [];
    const chooseIssuer = (url) => {
      chosen.push(url);
      state = { issuer: url, ready: false };   // the prop changed: a new discovery and client are under way
      setTimeout(() => { state = { issuer: url, ready: true }; }, 30);
    };
    const pa = buildMobilePodAuth({ hook: hookNow(), hookNow, chooseIssuer, session: fakeSession() });
    await pa.startSignIn({ issuer: LOCAL });
    expect(chosen).toEqual([LOCAL]);
    expect(signedInAt, 'signed in at the chosen provider, once it was ready').toEqual([LOCAL]);
  });

  it('a provider that never becomes ready says so, and signs in nowhere', async () => {
    let state = { issuer: 'https://login.inrupt.com', ready: true, lastError: null };
    const signedInAt = [];
    const hookNow = () => ({ ...state, signIn: async () => { signedInAt.push(state.issuer); return null; } });
    const chooseIssuer = (url) => { state = { issuer: url, ready: false, lastError: new Error('discovery failed') }; };
    const pa = buildMobilePodAuth({ hook: hookNow(), hookNow, chooseIssuer, session: fakeSession(), readyWithinMs: 60 });
    await expect(pa.startSignIn({ issuer: 'solidcommunity' })).rejects.toMatchObject({ code: 'ISSUER_NOT_READY' });
    expect(signedInAt).toEqual([]);
  });

  it('a provider whose registration REFUSED the app says it refused, at once, and signs in nowhere', async () => {
    // the phone walk with a Community Solid Server: 400 invalid_redirect_uri at registration, said as "did not answer"
    let state = { issuer: 'https://login.inrupt.com', ready: true, lastError: null };
    const signedInAt = [];
    const hookNow = () => ({ ...state, signIn: async () => { signedInAt.push(state.issuer); return null; } });
    const refused = Object.assign(new Error('registerClient: 400 invalid_redirect_uri'), { code: 'REGISTRATION_REJECTED', status: 400 });
    const chooseIssuer = (url) => { state = { issuer: url, ready: false, lastError: refused }; };
    const pa = buildMobilePodAuth({ hook: hookNow(), hookNow, chooseIssuer, session: fakeSession(), readyWithinMs: 5000 });
    const started = Date.now();
    await expect(pa.startSignIn({ issuer: 'http://localhost:3000' })).rejects.toMatchObject({ code: 'ISSUER_REFUSED', issuer: 'http://localhost:3000' });
    expect(Date.now() - started, 'a refusal is not waited out').toBeLessThan(1000);
    expect(signedInAt).toEqual([]);
  });
});
