/**
 * bundle-boot smoke — the lesson from 's TDZ trap is that
 * Vitest unit-tests pass when handlers import in ISOLATION; bundle-
 * load failures (TDZ, missing exports, polyfill drift) only show up
 * if you actually load the app entry.  This file loads the portable
 * core layer end-to-end so a future ReferenceError in agentBundle
 * fails CI, not Frits's first Android build.
 *
 * Doesn't cover the RN screen layer (vitest can't render RN
 * components) — that's #224A's Playwright/Expo-web job.
 */
import { describe, it, expect } from 'vitest';

import { composeManifests }                from '../src/core/composeManifests.js';
import { buildNavModels }                  from '../src/core/navModel.js';
import { bootAgentBundle }                 from '../src/core/agentBundle.js';
import { t, initLocalisation, setLang }    from '../src/core/localisation.js';

describe('#222 basis-mobile portable-core boot', () => {
  it('composeManifests merges all 6 apps without validator errors', () => {
    const catalogue = composeManifests();
    // All 6 expected apps land in appOrigins (Set).
    const apps = [...catalogue.appOrigins];
    expect(apps).toContain('basis');
    expect(apps).toContain('household');   // 2026-05-26 — mockHouseholdManifest is now the default (was opts-only)
    expect(apps).toContain('tasks');
    expect(apps).toContain('stoop');
    expect(apps).toContain('folio');
    expect(apps).toContain('calendar');
    // The merger aliases collisions deterministically (e.g.
    // `startDm` lives on both basis + stoop, the latter is
    // exposed as `stoop/startDm`).  These benign warnings are
    // fine; any UNEXPECTED warning should fail the test.
    const benign = /op-id collision: "\w+" also declared by/;
    const unexpected = (catalogue.warnings ?? []).filter((w) => !benign.test(w));
    expect(unexpected).toEqual([]);
  });

  // Root cause of the earlier drift: `buildNavModels()` kept its OWN hardcoded
  // manifest list (household-before-tasks) while `composeManifests().appOrigins`
  // deliberately orders tasks-before-household (#49 op-id-collision workaround:
  // both declare bare `addTask`, tasks must win). Fixed by making buildNavModels
  // consume composeManifests' single-source manifest list (_internalManifestList),
  // so the two lists are 1:1 by construction — this test pins that.
  it('composeManifests and buildNavModels return the same apps in the same order', () => {
    // 2026-05-26 dual-truth contract — see docs/manifest-pipeline.md
    // for the rationale.  A household-missing bug surfaced exactly
    // because these two lists drifted; this test pins them in sync.
    const catalogueApps = [...composeManifests().appOrigins];
    const navApps     = buildNavModels().map((n) => n.appOrigin);
    expect(navApps).toEqual(catalogueApps);
  });

  it('buildNavModels produces one NavModel per app via renderMobile', () => {
    const navs = buildNavModels();
    const apps = navs.map((n) => n.appOrigin);
    // Same six apps, deterministic order matching the bottom-tab
    // layout (basis first, content apps after).  Must match
    // composeManifests's order 1:1 — see docs/manifest-pipeline.md
    // for the dual-truth contract.
    expect(apps[0]).toBe('basis');
    expect(apps).toContain('household');
    expect(apps).toContain('tasks');
    expect(apps).toContain('stoop');
    expect(apps).toContain('folio');
    expect(apps).toContain('calendar');
    // Every NavModel must be JSON-serialisable (no circular refs).
    for (const { nav } of navs) {
      expect(() => JSON.stringify(nav)).not.toThrow();
      expect(nav.app).toBeTruthy();
    }
  });

  it('bootAgentBundle accepts a skillStub override (test-double seam, no real boot)', async () => {
    const bundle = await bootAgentBundle({
      skillStub: async (opId) => ({ ok: true, mockOp: opId }),
    });
    expect(typeof bundle.callSkill).toBe('function');
    expect(bundle.agent).toBe(null);                  // no real factory ran
    expect(bundle.transport).toEqual({ kind: 'stub' });
    const r = await bundle.callSkill('stoop', 'postRequest', { text: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.mockOp).toBe('postRequest');
  });

  // Real boot got heavier (2026-07-09: the agents-registry block — a CAS
  // write + 6 wireSkill registrations — joined the composition): under the
  // FULL parallel suite's CPU contention the default 5s times out, while the
  // isolated run takes ~2s. Same assertions, honest budget for a real boot.
  it('V1: real boot with VaultMemory wires createRealHouseholdAgent', { timeout: 20_000 }, async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const bundle = await bootAgentBundle({
      chatVault: new VaultMemory(),
      hostVault: new VaultMemory(),
    });
    expect(bundle.agent).toBeTruthy();
    // Real agent exposes a callSkill, an `sa` (secure-agent) handle,
    // and connectPeerTransport for NKN wiring.
    expect(typeof bundle.callSkill).toBe('function');
    expect(typeof bundle.agent.sa).toBe('object');
    expect(typeof bundle.agent.connectPeerTransport).toBe('function');
    // Bundle G2 (2026-05-27) — agentBundle fires
    // connectPeerTransport as fire-and-forget so boot stays fast.
    // transport.connecting:true is the post-boot shape; the actual
    // connect completes asynchronously (vitest doesn't await it).
    expect(bundle.transport.kind).toBe('nkn');
    expect(bundle.transport.connecting).toBe(true);

    // Smoke-call a household skill so we know the factory actually
    // routes a request (not just constructed shells).
    const r = await bundle.callSkill('household', 'listOpen', {});
    expect(r).toBeTruthy();
    expect(r.ok !== false || r.items).toBeTruthy(); // either ok-shaped reply or items

    await bundle.dispose();
  });

  it('V1: real boot with mocked nknLib registers NKN transport', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    // Minimal nknLib mock — just enough surface to let
    // sa.peer.connect() resolve without going to the real network.
    // The connect path may still fail (we don't fake the full client
    // lifecycle); we just verify the wiring SEAM doesn't crash.
    const fakeNknLib = { MultiClient: class { constructor() {} on() {} } };
    const bundle = await bootAgentBundle({
      chatVault: new VaultMemory(),
      hostVault: new VaultMemory(),
      nknLib:    fakeNknLib,
    });
    // Bundle G2 (2026-05-27) — connectPeerTransport is now
    // fire-and-forget so boot returns immediately with
    // {kind:'nkn', connecting:true}.  The actual connect resolves
    // asynchronously (the fake MultiClient never emits 'connect',
    // so we never get to {connected:true} in this test — that's
    // OK; we just need to know the seam fires).
    expect(bundle.transport.kind).toBe('nkn');
    expect(bundle.transport.connecting).toBe(true);
    await bundle.dispose();
  });

  it('V1: opts.asyncStorage synthesises VaultAsyncStorage for chat + host (#222.5)', async () => {
    // Mock AsyncStorage (same shape real RN exposes).
    const store = new Map();
    const mockAS = {
      async getItem(k)    { return store.has(k) ? store.get(k) : null; },
      async setItem(k, v) { store.set(k, String(v)); },
      async removeItem(k) { store.delete(k); },
      async getAllKeys()  { return [...store.keys()]; },
    };

    const bundle = await bootAgentBundle({ asyncStorage: mockAS });
    expect(bundle.agent).toBeTruthy();
    // The factory's identity-bootstrap path wrote the chat-side
    // agent's seed to its vault under the 'cc-chat-id:' prefix.
    // We verify by inspecting the mock store directly — if the
    // wiring is broken, the store stays empty.
    const writtenKeys = [...store.keys()];
    expect(writtenKeys.some((k) => k.startsWith('cc-chat-id:'))).toBe(true);
    // Host side too.
    expect(writtenKeys.some((k) => k.startsWith('cc-host-id:'))).toBe(true);
    await bundle.dispose();
  });

  it('M1: bundle exposes attachPeerWiring for post-boot router attach', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const fakeNknLib = { MultiClient: class { constructor() {} on() {} } };
    const bundle = await bootAgentBundle({
      chatVault: new VaultMemory(),
      hostVault: new VaultMemory(),
      nknLib:    fakeNknLib,
    });
    // App.js boots WITHOUT buildPeerWiring; ChatScreen attaches later.
    expect(typeof bundle.attachPeerWiring).toBe('function');
    expect(() => bundle.attachPeerWiring({
      onPeerMessage:  () => {},
      requestCatchUp: () => {},
    })).not.toThrow();
    // Tolerant of a partial / empty attach (defensive).
    expect(() => bundle.attachPeerWiring()).not.toThrow();
    expect(() => bundle.attachPeerWiring({})).not.toThrow();
    await bundle.dispose();
  });

  it('M1: stub bundle has a no-op attachPeerWiring (shape parity)', async () => {
    const bundle = await bootAgentBundle({ skillStub: async () => ({ ok: true }) });
    expect(typeof bundle.attachPeerWiring).toBe('function');
    expect(() => bundle.attachPeerWiring({ onPeerMessage: () => {} })).not.toThrow();
  });

  it('localisation: t() resolves locale keys + falls back to key', async () => {
    await initLocalisation({ lng: 'en' });
    expect(t('app.name')).toBe('basis');
    expect(t('chat.placeholder')).toMatch(/slash command/i);

    setLang('nl');
    expect(t('chat.placeholder')).toMatch(/slash-commando/i);
    setLang('en');

    expect(t('does.not.exist')).toBe('does.not.exist');
    expect(t('boot.boot_failed', { message: 'boom' })).toMatch(/boom/);
  });
});
