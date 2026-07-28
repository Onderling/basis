/**
 * Bundle G3 — mobile NKN-on-pod wrapper contract.
 *
 * Pins the shape `buildLookupPeerAddrByWebid` + `buildPublishPeerAddrToPod`
 * expose so /lookup-peer + /publish-peer slash handlers (in canonical
 * `apps/basis/src/core/localBuiltins.js`) work without per-
 * surface branching.  Mirrors web's pattern from main.js:1421-1435 but
 * threads the OidcSessionRN's `getAuthenticatedFetch()` instead of the
 * @inrupt browser fetch.
 *
 * Test style: same as podAuth.test.js — fake the OidcSessionRN with
 * the minimal surface our wrappers touch (`isAuthenticated`, `webid`,
 * `getAuthenticatedFetch`).
 */
import { describe, it, expect } from 'vitest';

import {
  buildLookupPeerAddrByWebid,
  buildPublishPeerAddrToPod,
} from '../src/core/podPeerAddr.js';

/**
 * Build a fake OidcSessionRN.  `routes` is a `Map<urlPrefix, handler>`
 * where the handler returns `{status, body, contentType}` or `null`
 * to indicate "no match → 404".
 */
function fakeSession({ webid = null, authed = false, routes = new Map() } = {}) {
  return {
    isAuthenticated: () => authed,
    get webid() { return webid; },
    getAuthenticatedFetch() {
      return async (input, _init = {}) => {
        const url = typeof input === 'string' ? input : input?.url;
        for (const [prefix, handler] of routes) {
          if (url.startsWith(prefix)) {
            const r = handler(url) ?? null;
            if (r === null) break;
            return {
              ok:      r.status >= 200 && r.status < 300,
              status:  r.status,
              headers: { get: (k) => k.toLowerCase() === 'content-type' ? (r.contentType ?? 'text/turtle') : null },
              text:    async () => r.body ?? '',
            };
          }
        }
        return {
          ok: false, status: 404,
          headers: { get: () => null },
          text: async () => '',
        };
      };
    },
  };
}

describe('Bundle G3 (#265) — buildLookupPeerAddrByWebid', () => {
  it('throws "Sign in first" when no session is authenticated', async () => {
    const ref = { current: fakeSession({ authed: false }) };
    const lookup = buildLookupPeerAddrByWebid({ sessionRef: ref });
    await expect(lookup('https://bob.example/#me')).rejects.toThrow(/sign in/i);
  });

  it('throws "Sign in first" when sessionRef.current is null', async () => {
    const ref = { current: null };
    const lookup = buildLookupPeerAddrByWebid({ sessionRef: ref });
    await expect(lookup('https://bob.example/#me')).rejects.toThrow(/sign in/i);
  });

  it('returns null when the peer pod has no identity.ttl', async () => {
    const routes = new Map([
      ['https://bob.example/profile/card', () => ({
        status: 200, contentType: 'text/turtle',
        body: `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<#me> pim:storage <https://bob.example/>.`,
      })],
      // Naming migration 2026-07-29: this peer publishes at the LEGACY path with the legacy
      // prefix — discovery must still find them (a peer on an older app version).
      ['https://bob.example/canopy/identity/identity.ttl', () => ({
        status: 404, contentType: 'text/turtle', body: '',
      })],
    ]);
    const ref = { current: fakeSession({
      webid: 'https://alice.example/#me', authed: true, routes,
    }) };
    const lookup = buildLookupPeerAddrByWebid({ sessionRef: ref });
    const addr = await lookup('https://bob.example/profile/card#me');
    expect(addr).toBeNull();
  });

  it('returns the NKN address when the peer pod publishes one', async () => {
    const routes = new Map([
      ['https://bob.example/profile/card', () => ({
        status: 200, contentType: 'text/turtle',
        body: `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<#me> pim:storage <https://bob.example/>.`,
      })],
      // Naming migration 2026-07-29: this peer publishes at the LEGACY path with the legacy
      // prefix — discovery must still find them (a peer on an older app version).
      ['https://bob.example/canopy/identity/identity.ttl', () => ({
        status: 200, contentType: 'text/turtle',
        body: `@prefix canopy: <https://canopy.dev/ns#>.
<#me> canopy:peerAddr "app.deadbeef1234567890".
`,
      })],
    ]);
    const ref = { current: fakeSession({
      webid: 'https://alice.example/#me', authed: true, routes,
    }) };
    const lookup = buildLookupPeerAddrByWebid({ sessionRef: ref });
    const addr = await lookup('https://bob.example/profile/card#me');
    expect(addr).toBe('app.deadbeef1234567890');
  });
});

describe('Bundle G3 (#265) — buildPublishPeerAddrToPod', () => {
  it('throws "Sign in first" when no session is authenticated', async () => {
    const ref = { current: fakeSession({ authed: false }) };
    const publish = buildPublishPeerAddrToPod({
      sessionRef: ref,
      agent: { peer: { address: 'app.abc' } },
    });
    await expect(publish()).rejects.toThrow(/sign in/i);
  });

  it('throws when NKN address isn\'t available on the agent', async () => {
    const ref = { current: fakeSession({
      webid: 'https://alice.example/#me', authed: true,
    }) };
    const publish = buildPublishPeerAddrToPod({
      sessionRef: ref,
      agent: { peer: {} },   // no address
    });
    await expect(publish()).rejects.toThrow(/peer-connect/i);
  });

  it('returns ok=true after a successful pod write', async () => {
    const writes = [];
    // Order matters: longer/more-specific prefixes first so the
    // identity.ttl route wins over the container probe (which shares
    // its prefix).
    const routes = new Map([
      // PUT on the identity.ttl file → 201 Created.
      ['https://alice.example/onderling/identity/identity.ttl', (url) => {
        writes.push(url);
        return { status: 201, contentType: 'text/turtle', body: '' };
      }],
      // HEAD on the container (ensureContainer probe) → 200 (exists).
      ['https://alice.example/onderling/identity/', () => ({
        status: 200, contentType: 'text/turtle', body: '',
      })],
      // WebID doc → exposes pim:storage.
      ['https://alice.example/profile/card', (url) => {
        if (url.endsWith('profile/card')) {
          return {
            status: 200, contentType: 'text/turtle',
            body: `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<#me> pim:storage <https://alice.example/>.`,
          };
        }
        return null;
      }],
    ]);
    // Override the authenticated-fetch to capture the request body
    // (the canned-routes shim above ignores `init.body`).
    const session = fakeSession({
      webid: 'https://alice.example/profile/card#me', authed: true, routes,
    });
    const originalFetch = session.getAuthenticatedFetch();
    const seenBodies = [];
    session.getAuthenticatedFetch = () => async (input, init = {}) => {
      if (init?.method === 'PUT' && typeof init.body === 'string') {
        seenBodies.push({ url: input, body: init.body });
      }
      return originalFetch(input, init);
    };
    const ref = { current: session };
    const publish = buildPublishPeerAddrToPod({
      sessionRef: ref,
      agent: { peer: { address: 'app.feedface000111222' } },
    });
    const result = await publish();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.url).toBe('https://alice.example/onderling/identity/identity.ttl');
    // The PUT body carries the NKN triple.
    const ttlWrite = seenBodies.find(w => w.url.endsWith('identity.ttl'));
    expect(ttlWrite?.body).toContain('canopy:peerAddr');
    expect(ttlWrite?.body).toContain('app.feedface000111222');
  });
});
