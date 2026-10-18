/**
 * DCR helper tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  loadOrRegisterClient,
  registerClient,
  buildRegistrationBody,
  clearStoredClient,
  _dcrInternal,
} from '../index.js';

const { issuerKey, resolveKeyPrefix, DEFAULT_KEY_PREFIX } = _dcrInternal;

function buildStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItemAsync:    vi.fn(async (k) => (m.has(k) ? m.get(k) : null)),
    setItemAsync:    vi.fn(async (k, v) => { m.set(k, String(v)); }),
    deleteItemAsync: vi.fn(async (k) => { m.delete(k); }),
    _peek: () => Object.fromEntries(m),
  };
}

describe('resolveKeyPrefix', () => {
  it('default when nothing is supplied', () => {
    expect(resolveKeyPrefix()).toBe(DEFAULT_KEY_PREFIX);
    expect(resolveKeyPrefix('')).toBe(DEFAULT_KEY_PREFIX);
  });
  it('bare app-id grows into the canonical DCR prefix', () => {
    expect(resolveKeyPrefix('folio')).toBe('folio-dcr-client-id-');
    expect(resolveKeyPrefix('pinboard')).toBe('pinboard-dcr-client-id-');
  });
  it('full prefix passes through', () => {
    expect(resolveKeyPrefix('myapp-dcr-client-id-')).toBe('myapp-dcr-client-id-');
  });
});

describe('issuerKey', () => {
  it('strips scheme and unsafe chars; uses prefix', () => {
    const k = issuerKey('https://login.inrupt.com', 'folio-dcr-client-id-');
    expect(k).toBe('folio-dcr-client-id-login.inrupt.com');
  });
  it('keeps host:port style intact via the prefix sanitiser', () => {
    const k = issuerKey('http://localhost:3000/idp', 'pinboard-dcr-client-id-');
    expect(k).toBe('pinboard-dcr-client-id-localhost_3000_idp');
  });
});

describe('buildRegistrationBody', () => {
  it('produces a Solid-OIDC-shaped registration body', () => {
    const body = buildRegistrationBody({
      redirectUri: 'pinboard://auth/callback',
      clientName:  'Pinboard (mobile)',
      scopes:      ['openid', 'webid', 'offline_access'],
    });
    expect(body.redirect_uris).toEqual(['pinboard://auth/callback']);
    expect(body.client_name).toBe('Pinboard (mobile)');
    expect(body.application_type).toBe('native');
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.grant_types).toContain('authorization_code');
    expect(body.grant_types).toContain('refresh_token');
    expect(body.response_types).toEqual(['code']);
    expect(body.scope).toBe('openid webid offline_access');
  });
});

describe('registerClient', () => {
  it('rejects when discovery has no registration_endpoint', async () => {
    await expect(registerClient({
      discovery: {}, redirectUri: 'x://y',
    })).rejects.toMatchObject({ code: 'NO_REGISTRATION_ENDPOINT' });
  });

  it('parses a successful response into a normalised shape', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ client_id: 'CID', client_id_issued_at: 1234 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const out = await registerClient({
      discovery:   { registration_endpoint: 'https://idp/register' },
      redirectUri: 'pinboard://auth/callback',
      clientName:  'Pinboard',
      fetchFn,
    });
    expect(out.client_id).toBe('CID');
    expect(out.client_id_issued_at).toBe(1234);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('surfaces 4xx as REGISTRATION_REJECTED', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'bad' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(registerClient({
      discovery:   { registration_endpoint: 'https://idp/register' },
      redirectUri: 'pinboard://auth/callback',
      fetchFn,
    })).rejects.toMatchObject({ code: 'REGISTRATION_REJECTED', status: 400 });
  });
});

describe('loadOrRegisterClient', () => {
  it('returns cached client_id when present', async () => {
    const store = buildStore({ 'folio-dcr-client-id-login.inrupt.com': 'CACHED' });
    const id = await loadOrRegisterClient({
      issuer:      'https://login.inrupt.com',
      discovery:   { registration_endpoint: 'https://idp/register' },
      redirectUri: 'folio://auth/callback',
      store,
      keyPrefix:   'folio',
    });
    expect(id).toBe('CACHED');
  });

  it('registers fresh + caches when nothing is stored (per-prefix)', async () => {
    const store = buildStore();
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ client_id: 'NEW' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const id = await loadOrRegisterClient({
      issuer:      'https://login.inrupt.com',
      discovery:   { registration_endpoint: 'https://idp/register' },
      redirectUri: 'pinboard://auth/callback',
      store,
      keyPrefix:   'pinboard',
      fetchFn,
    });
    expect(id).toBe('NEW');
    expect(store._peek()['pinboard-dcr-client-id-login.inrupt.com']).toBe('NEW');
    // folio's slot is untouched.
    expect(store._peek()['folio-dcr-client-id-login.inrupt.com']).toBeUndefined();
  });
});

describe('clearStoredClient', () => {
  it('deletes the prefix-scoped key', async () => {
    const store = buildStore({
      'folio-dcr-client-id-login.inrupt.com': 'F',
      'pinboard-dcr-client-id-login.inrupt.com': 'S',
    });
    await clearStoredClient('https://login.inrupt.com', store, 'folio');
    expect(store._peek()['folio-dcr-client-id-login.inrupt.com']).toBeUndefined();
    expect(store._peek()['pinboard-dcr-client-id-login.inrupt.com']).toBe('S');
  });
});
