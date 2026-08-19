/**
 * Stoop — Phase 20 tests.
 *
 * Solid pod sign-in: `startPodSignIn` → `completePodSignIn` →
 * `bundle.cache.attachInner(<pod-source>)` → `signOutOfPod`.
 *
 * Inrupt's OIDC `Session` is stubbed via `_setSessionFactory` (the
 * substrate's test seam, mirrored from Folio's pattern).  The pod
 * DataSource is stubbed via `dataSourceFactory` so we don't need a
 * live SolidPodSource to assert wiring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import {
  startPodSignIn,
  completePodSignIn,
  signOutOfPod,
  podSignInStatus,
} from '../src/lib/podSignIn.js';
import { _setSolidAuthNodeSessionFactory } from '@onderling/oidc-session';

const ANNE  = 'https://id.example/anne';
const WEBID = 'https://alice.solidcommunity.net/profile/card#me';

/* ── A fake Inrupt Session that captures + exposes login args ──────────── */

function makeFakeSession({ webid = WEBID, expirationDate = Date.now() + 60_000 } = {}) {
  const events = {
    _h: new Map(),
    on(name, cb) { this._h.set(name, cb); return this; },
    emit(name, payload) { this._h.get(name)?.(payload); },
  };
  return {
    info: { isLoggedIn: false, webId: null },
    events,
    fetch: async (_url, _init) => {
      // Default: just respond with a tiny turtle profile so derivePodRoot()
      // can fall back to the WebID origin without hitting the network.
      return new Response('# stub profile', { status: 200, headers: { 'Content-Type': 'text/turtle' } });
    },
    async login(opts) {
      // Capture for assertion. handleRedirect drives the start() flow.
      this._lastLogin = opts;
      if (typeof opts.handleRedirect === 'function') {
        opts.handleRedirect('https://idp.example/authorize?client_id=stoop&state=xyz');
      }
    },
    async handleIncomingRedirect(_url) {
      this.info = { isLoggedIn: true, webId: webid, expirationDate };
    },
    async logout() {
      this.info = { isLoggedIn: false };
    },
  };
}

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
}

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

let fakeSession;

beforeEach(() => {
  fakeSession = makeFakeSession();
  _setSolidAuthNodeSessionFactory(() => fakeSession);
});

afterEach(() => { _setSolidAuthNodeSessionFactory(null); });

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('Stoop V1.5 Phase 20 — direct (lib) entry points', () => {
  it('startPodSignIn returns the IdP authorize URL', async () => {
    const bundle = await buildBundle();
    const r = await startPodSignIn({
      bundle,
      issuer:      'https://idp.example',
      redirectUrl: 'http://127.0.0.1:8888/auth-callback.html',
    });
    expect(r.ok).toBe(true);
    expect(r.redirectUrl).toContain('https://idp.example/authorize');
  });

  it('completePodSignIn attaches a pod-shaped DataSource to bundle.cache', async () => {
    const bundle = await buildBundle();
    expect(bundle.cache.hasInner).toBe(false);

    await startPodSignIn({
      bundle, issuer: 'https://idp.example', redirectUrl: 'http://127.0.0.1:8888/cb',
    });

    let factoryArgs = null;
    const fakeDataSource = {
      async read()  {}, async write() {}, async delete() {}, async list() { return []; },
    };
    const r = await completePodSignIn({
      bundle,
      callbackUrl: 'http://127.0.0.1:8888/cb?code=abc&state=xyz',
      dataSourceFactory: (args) => { factoryArgs = args; return fakeDataSource; },
    });
    expect(r.ok).toBe(true);
    expect(r.webid).toBe(WEBID);
    expect(r.podRoot).toBeTruthy();
    expect(factoryArgs.podUrl).toBe(r.podRoot);
    expect(typeof factoryArgs.fetch).toBe('function');
    expect(bundle.cache.hasInner).toBe(true);
  });

  it('signOutOfPod detaches the inner + clears the OIDC session', async () => {
    const bundle = await buildBundle();
    await startPodSignIn({
      bundle, issuer: 'https://idp.example', redirectUrl: 'http://127.0.0.1:8888/cb',
    });
    const fake = { async read() {}, async write() {}, async delete() {}, async list() { return []; } };
    await completePodSignIn({
      bundle,
      callbackUrl: 'http://127.0.0.1:8888/cb?code=abc',
      dataSourceFactory: () => fake,
    });
    expect(bundle.cache.hasInner).toBe(true);

    await signOutOfPod({ bundle });
    expect(bundle.cache.hasInner).toBe(false);
    expect(bundle.oidcSession).toBeNull();
  });

  it('podSignInStatus reflects current state', async () => {
    const bundle = await buildBundle();
    expect(podSignInStatus({ bundle })).toEqual({ signedIn: false });

    await startPodSignIn({
      bundle, issuer: 'https://idp.example', redirectUrl: 'http://127.0.0.1:8888/cb',
    });
    await completePodSignIn({
      bundle,
      callbackUrl: 'http://127.0.0.1:8888/cb?code=abc',
      dataSourceFactory: () => ({
        async read() {}, async write() {}, async delete() {}, async list() { return []; },
      }),
    });
    const s = podSignInStatus({ bundle });
    expect(s.signedIn).toBe(true);
    expect(s.webid).toBe(WEBID);
    expect(s.podAttached).toBe(true);
  });

  it('podSignInStatus stays signed-in on an expired-but-refreshable session, false after sign-out', () => {
    // access token expired (isAuthenticated false) but a webid is present → still signed in (refresh-capable);
    // don't lag the UI back to "Local only".
    expect(podSignInStatus({ bundle: { oidcSession: { isAuthenticated: () => false, webid: WEBID } } }).signedIn).toBe(true);
    // signed out → webid cleared → not signed in
    expect(podSignInStatus({ bundle: { oidcSession: { isAuthenticated: () => false, webid: null } } }).signedIn).toBe(false);
  });
});

describe('Stoop V1.5 Phase 20 — sign-in skills', () => {
  it('startPodSignIn skill returns the authorize URL', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'startPodSignIn', {
      issuer: 'https://idp.example',
      redirectUrl: 'http://127.0.0.1:8888/auth-callback.html',
    });
    expect(r.ok).toBe(true);
    expect(r.redirectUrl).toContain('https://idp.example/authorize');
    expect(bundle.metrics.snapshot()['pod-sign-in-start']?.count).toBe(1);
  });

  it('skills reject missing args with a useful error', async () => {
    const bundle = await buildBundle();
    const r1 = await callSkill(bundle.agent, 'startPodSignIn', { issuer: 'x' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('redirectUrl');

    const r2 = await callSkill(bundle.agent, 'completePodSignIn', { callbackUrl: 'http://x/cb' });
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('no sign-in in progress');
  });

  it('podSignInStatus skill mirrors the lib status', async () => {
    const bundle = await buildBundle();
    const s = await callSkill(bundle.agent, 'podSignInStatus', {});
    expect(s).toEqual({ signedIn: false });
  });
});
