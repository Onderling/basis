/**
 * oidcSignIn pure-path tests — completeSignIn + extractWebIdFromIdToken.
 *
 * The hook itself (useOidcSignIn) is not tested at the substrate level
 * — it requires React + RN + expo-auth-session in the runtime, which
 * we mock in setup.js purely so import doesn't blow up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  completeSignIn,
  extractWebIdFromIdToken,
  _setExchangeFn,
  DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES,
} from '../src/completeSignIn.js';

describe('module exports', () => {
  it('exposes the legacy defaults', () => {
    expect(DEFAULT_INRUPT_ISSUER).toBe('https://login.inrupt.com');
    expect(DEFAULT_SCOPES).toEqual(['openid', 'webid', 'offline_access']);
  });
});

describe('completeSignIn', () => {
  beforeEach(() => _setExchangeFn(null));

  it('rejects a missing result', async () => {
    await expect(completeSignIn({})).rejects.toThrow(/result required/);
  });

  it('rejects a non-success result', async () => {
    await expect(completeSignIn({
      result: { type: 'cancel' },
      discovery: { tokenEndpoint: 'https://idp/token' },
    })).rejects.toMatchObject({ code: 'AUTH_DISMISSED' });
  });

  it('rejects when the redirect did not include a code', async () => {
    await expect(completeSignIn({
      result: { type: 'success', params: {} },
      discovery: { tokenEndpoint: 'https://idp/token' },
    })).rejects.toMatchObject({ code: 'NO_AUTH_CODE' });
  });

  it('rejects when discovery has no tokenEndpoint', async () => {
    await expect(completeSignIn({
      result:    { type: 'success', params: { code: 'C' } },
      discovery: {},
    })).rejects.toMatchObject({ code: 'NO_TOKEN_ENDPOINT' });
  });

  it('exchanges the code and returns the token set', async () => {
    _setExchangeFn(vi.fn(async () => ({
      accessToken:  'A',
      refreshToken: 'R',
      idToken:      'fake',
      expiresIn:    3600,
    })));
    const out = await completeSignIn({
      result:      { type: 'success', params: { code: 'C' } },
      request:     { codeVerifier: 'V' },
      discovery:   { tokenEndpoint: 'https://idp/token' },
      redirectUri: 'pinboard://auth/callback',
      clientId:    'client-id',
      issuer:      'https://idp',
    });
    expect(out.accessToken).toBe('A');
    expect(out.refreshToken).toBe('R');
    expect(out.expiresIn).toBe(3600);
    expect(typeof out.expiresAt).toBe('number');
    expect(out.issuer).toBe('https://idp');
    expect(out.clientId).toBe('client-id');
  });
});

describe('extractWebIdFromIdToken', () => {
  it('returns null for empty / non-jwt input', () => {
    expect(extractWebIdFromIdToken(null)).toBeNull();
    expect(extractWebIdFromIdToken('')).toBeNull();
    expect(extractWebIdFromIdToken('not.a.jwt.really')).toBeNull();
  });

  it('extracts webid claim when present', () => {
    const payload = { webid: 'https://anne.example/me', sub: 'fallback' };
    const fakeJwt = ['x', Buffer.from(JSON.stringify(payload)).toString('base64'), 'y'].join('.');
    expect(extractWebIdFromIdToken(fakeJwt)).toBe('https://anne.example/me');
  });

  it('falls back to sub when webid claim absent', () => {
    const payload = { sub: 'https://anne.example/sub' };
    const fakeJwt = ['x', Buffer.from(JSON.stringify(payload)).toString('base64'), 'y'].join('.');
    expect(extractWebIdFromIdToken(fakeJwt)).toBe('https://anne.example/sub');
  });
});
