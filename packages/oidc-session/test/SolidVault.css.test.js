/**
 * SolidVault — Community Solid Server integration tests.
 *
 * These tests log in to a real CSS instance using client credentials issued
 * by the CSS `idp/credentials/` endpoint, then drive the pod with the resulting
 * authenticated fetch.  Skipped if the env vars below are not set.
 *
 * The round-trips use plain `fetch` on purpose. They used to go through a
 * `SolidPodSource` imported from `@onderling/core` — which stopped existing there
 * when concrete adapters moved out of the kernel, so all three of them threw
 * "SolidPodSource is not a constructor" and had been doing so unnoticed. Reaching
 * for it again would mean this package depending on `@onderling/pod-client`, which
 * depends on THIS one; and it was never the subject anyway. What this suite owns is
 * the authenticated fetch: that a real IdP issues one, that it survives a refresh,
 * and that a second vault-sharing instance recovers it without logging in again.
 *
 * Required environment variables:
 *   CSS_URL              http(s)://host:port/   — base URL of the CSS instance
 *   CSS_WEBID            https://...            — the user's WebID URI on this CSS
 *   CSS_OIDC_ISSUER      https://...            — usually identical to CSS_URL
 *   CSS_CLIENT_ID        the client_id obtained via /idp/credentials/
 *   CSS_CLIENT_SECRET    the client_secret obtained via /idp/credentials/
 *
 * Optional:
 *   CSS_POD_ROOT         override pod root when WebID doesn't carry pim:storage
 *   CSS_SCRATCH          relative scratch container path (default 'scratch/')
 *
 * To set up a CSS for these tests, see:
 *   coding-plans/track-A-pod-substrate.md §Test infrastructure
 *   https://communitysolidserver.github.io/CommunitySolidServer/latest/usage/client-credentials/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SolidVault } from '../src/SolidVault.js';
import { VaultMemory } from '@onderling/vault';

const CSS_URL          = process.env.CSS_URL;
const CSS_WEBID        = process.env.CSS_WEBID;
const CSS_OIDC_ISSUER  = process.env.CSS_OIDC_ISSUER ?? CSS_URL;
const CSS_CLIENT_ID    = process.env.CSS_CLIENT_ID;
const CSS_CLIENT_SECRET = process.env.CSS_CLIENT_SECRET;
const CSS_POD_ROOT     = process.env.CSS_POD_ROOT;
const SCRATCH          = process.env.CSS_SCRATCH ?? 'scratch/';

const HAS_CONFIG = !!(CSS_URL && CSS_WEBID && CSS_CLIENT_ID && CSS_CLIENT_SECRET);
const describeIf = HAS_CONFIG ? describe : describe.skip;

describeIf('SolidVault against CSS', () => {
  let vault, podRoot, sv;
  const created = [];

  /** PUT/GET/DELETE a text resource with the session's fetch — the thing under test, unwrapped. */
  const put = async (fetchFn, key, body) => {
    const res = await fetchFn(`${podRoot}${key}`, {
      method: 'PUT', headers: { 'content-type': 'text/plain' }, body,
    });
    if (!res.ok) throw new Error(`PUT ${key} → ${res.status}`);
    return `${podRoot}${key}`;
  };
  const get = async (fetchFn, key) => {
    const res = await fetchFn(`${podRoot}${key}`, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`GET ${key} → ${res.status}`);
    return { body: await res.text(), contentType: res.headers.get('content-type') ?? '' };
  };

  beforeAll(async () => {
    vault = new VaultMemory();
    sv = new SolidVault({
      webid:      CSS_WEBID,
      oidcIssuer: CSS_OIDC_ISSUER,
      vault,
    });
    await sv.login({
      clientId:     CSS_CLIENT_ID,
      clientSecret: CSS_CLIENT_SECRET,
    });
    podRoot = CSS_POD_ROOT ?? await sv.getPodRoot();
    if (!podRoot) {
      throw new Error('Could not determine pod root; set CSS_POD_ROOT or ensure WebID profile carries pim:storage');
    }
  });

  afterAll(async () => {
    if (!sv) return;
    const fetchFn = sv.getAuthenticatedFetch();
    for (const key of created.reverse()) {
      try { await fetchFn(`${podRoot}${key}`, { method: 'DELETE' }); } catch { /* best-effort */ }
    }
  });

  it('login establishes an authenticated session', () => {
    expect(sv.isAuthenticated()).toBe(true);
  });

  it('getAuthenticatedFetch round-trips a write+read against the pod', async () => {
    const fetchFn = sv.getAuthenticatedFetch();
    const key  = `${SCRATCH}solidvault-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const body = 'hello from solidvault css test';

    const uri = await put(fetchFn, key, body);
    created.push(key);
    expect(uri).toMatch(key);

    const read = await get(fetchFn, key);
    expect(read.body).toBe(body);
    expect(read.contentType).toMatch(/^text\/plain/);
  });

  it('refresh() obtains a fresh access token without losing the session', async () => {
    await sv.refresh();
    expect(sv.isAuthenticated()).toBe(true);

    // Sanity: the refreshed fetch can still hit the pod.
    const fetchFn = sv.getAuthenticatedFetch();
    const key     = `${SCRATCH}solidvault-refresh-${Date.now()}.txt`;
    await put(fetchFn, key, 'after refresh');
    created.push(key);
    expect((await get(fetchFn, key)).body).toBe('after refresh');
  });

  it('a fresh SolidVault sharing the same vault recovers without re-login', async () => {
    const sv2 = new SolidVault({ webid: CSS_WEBID, oidcIssuer: CSS_OIDC_ISSUER, vault });
    // No explicit credentials — must pull them from the vault.
    await sv2.login({});
    expect(sv2.isAuthenticated()).toBe(true);

    const fetchFn = sv2.getAuthenticatedFetch();
    const key     = `${SCRATCH}solidvault-restore-${Date.now()}.txt`;
    await put(fetchFn, key, 'restored');
    created.push(key);
    expect((await get(fetchFn, key)).body).toBe('restored');
  });
});
