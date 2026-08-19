/**
 * Real-pod routing decision + URI shaping (S4 circle OIDC). Unit-tests `realPodRouting`
 * with a mock session + stub PodClient/SolidOidcAuth — no real pod. The end-to-end "producer
 * over a real CSS pod" is verified by circlePodProducer.css.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { realPodRouting, podRootFromWebid } from '../src/v2/circleRealPod.js';

class StubPodClient { constructor(opts) { this.opts = opts; } }
class StubSolidOidcAuth { constructor(opts) { this.vault = opts.vault; } }
const deps = { PodClient: StubPodClient, SolidOidcAuth: StubSolidOidcAuth };

describe('podRootFromWebid', () => {
  it('strips the profile doc to the pod root', () => {
    expect(podRootFromWebid('https://me.pod/profile/card#me')).toBe('https://me.pod/');
    expect(podRootFromWebid('http://localhost:3000/alice/profile/card#me')).toBe('http://localhost:3000/alice/');
  });
  it('null for non-http / empty', () => {
    expect(podRootFromWebid('')).toBeNull();
    expect(podRootFromWebid(null)).toBeNull();
    expect(podRootFromWebid('did:key:abc')).toBeNull();
  });
});

describe('realPodRouting', () => {
  const session = { webid: 'https://me.pod/profile/card#me', isLoggedIn: true, fetch: vi.fn() };

  it('null when not signed in / no session', () => {
    expect(realPodRouting(null, deps)).toBeNull();
    expect(realPodRouting({ ...session, isLoggedIn: false }, deps)).toBeNull();
    expect(realPodRouting({ ...session, fetch: undefined }, deps)).toBeNull();
  });

  it('builds a routing over the pod root with the session fetch', () => {
    const r = realPodRouting(session, deps);
    expect(r.podRoot).toBe('https://me.pod/');
    expect(r.circleRootUri('c1')).toBe('https://me.pod/circles/c1');
    const pc = r.makePodClient('c1');
    expect(pc).toBeInstanceOf(StubPodClient);
    expect(pc.opts.podRoot).toBe('https://me.pod/');
    // the auth wraps the session's DPoP fetch
    expect(pc.opts.auth.vault.getAuthenticatedFetch()).toBe(session.fetch);
    expect(pc.opts.auth.vault.webid).toBe(session.webid);
  });

  it('honours a custom circles path', () => {
    const r = realPodRouting(session, { ...deps, circlesPath: 'circles' });
    expect(r.circleRootUri('c1')).toBe('https://me.pod/circles/c1');
  });
});
