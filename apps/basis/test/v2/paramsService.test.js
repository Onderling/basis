/**
 * The parameter register (#36), basis side — the worked cluster, the composition seam, and the value routing
 * that CROSSES into the real homes.
 *
 * Claims: the `nearbyAsks` migration is behaviour-preserving; the register's declared default agrees with the
 * exported const (one source of truth); the `set-param` kind gate holds; and — the seam that matters — a set
 * value REACHES its real home (device/agent → `@onderling/local-store` settings blobs; circle → the circle
 * policy `settings` map) and reads back out, not just a unit test either side.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { ASK_DEFAULT_TTL_MS, ASK_MAX_TTL_MS, ASK_MAX_TEXT } from '../../src/v2/nearbyAsks.js';
import { createParamsService, basisParamRegistry } from '../../src/v2/paramsService.js';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';

describe('the nearbyAsks migration is behaviour-preserving', () => {
  it('param() returns the exact numbers the plain consts held', () => {
    expect(ASK_DEFAULT_TTL_MS).toBe(30 * 60_000);
    expect(ASK_MAX_TTL_MS).toBe(4 * 60 * 60_000);
    expect(ASK_MAX_TEXT).toBe(280);
  });
});

describe('the register AGREES with the declaration site (one source of truth, pinned)', () => {
  it('the declared default for the settable ask-ttl equals the exported const', () => {
    const reg = basisParamRegistry();
    expect(reg.defaultOf('nearby.ask.defaultTtlMs')).toBe(ASK_DEFAULT_TTL_MS);
    expect(reg.isSettable('nearby.ask.defaultTtlMs')).toBe(true);   // kind:user
  });

  it('the internal caps are NOT settable through the register (immutable by construction)', () => {
    const reg = basisParamRegistry();
    expect(reg.has('nearby.ask.maxTtlMs')).toBe(false);
    expect(reg.has('nearby.ask.maxText')).toBe(false);
  });
});

describe('the set-param op — the kind gate (decision D)', () => {
  it('refuses an internal cap and an unknown key (never routes them)', async () => {
    const routed = [];
    const svc = createParamsService({ homes: { agent: (p) => routed.push(p) } });
    expect(await svc.callSkill('set-param', { key: 'nearby.ask.maxText', value: 9999 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });   // internal cap is not even in the settable register
    expect(await svc.callSkill('set-param', { key: 'not.a.param', value: 1 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });
    expect(routed).toEqual([]);
  });

  it('list-user-params projects only the settable slice (the settings-form seed)', async () => {
    const svc = createParamsService();
    const { params } = await svc.callSkill('list-user-params');
    expect(params.map((p) => p.key)).toEqual(['nearby.ask.defaultTtlMs']);
  });
});

// ── The crossing: a set REACHES its real home and reads back (decision C, all three scopes) ──────────────────
describe('set-param routes to the real homes and the value round-trips', () => {
  // A register with one settable param per scope: agent (the real one) + device + circle (proof params).
  const registerWithAllScopes = () => basisParamRegistry([
    { key: 'catchup.pollIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 5000 },
    { key: 'nearby.match.minShared', scope: PARAM_SCOPE.CIRCLE, kind: PARAM_KIND.USER, default: 1 },
  ]);

  const wire = () => {
    const dataSource = memoryDataSource();
    const circleStore = new Map();
    const circlePolicy = createCirclePolicyStore({
      load: (id) => circleStore.get(id) ?? null,
      save: (id, value) => { circleStore.set(id, value); },
    });
    const svc = createParamsService({
      register: registerWithAllScopes(), dataSource, deviceId: 'dev-1', circlePolicy,
    });
    return { svc, dataSource, circlePolicy };
  };

  it('AGENT scope → shared.json, and loadSettings reads it back', async () => {
    const { svc, dataSource } = wire();
    const r = await svc.callSkill('set-param', { key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 });
    expect(r).toMatchObject({ ok: true, scope: 'agent' });
    const settings = await svc.settingsModule.loadSettings({ dataSource, deviceId: 'dev-1' });
    expect(settings['nearby.ask.defaultTtlMs']).toBe(10 * 60_000);
    // landed in shared.json specifically
    const sharedBlob = JSON.parse(await dataSource.read(svc.settingsModule.SETTINGS_SHARED_PATH));
    expect(sharedBlob['nearby.ask.defaultTtlMs']).toBe(10 * 60_000);
  });

  it('DEVICE scope → the device blob (not shared), and reads back', async () => {
    const { svc, dataSource } = wire();
    await svc.callSkill('set-param', { key: 'catchup.pollIntervalMs', value: 3000 });
    const settings = await svc.settingsModule.loadSettings({ dataSource, deviceId: 'dev-1' });
    expect(settings['catchup.pollIntervalMs']).toBe(3000);
    const deviceBlob = JSON.parse(await dataSource.read(`${svc.settingsModule.SETTINGS_DEVICE_PATH_PREFIX}dev-1.json`));
    expect(deviceBlob['catchup.pollIntervalMs']).toBe(3000);
  });

  it('CIRCLE scope → the circle policy settings map (per circleId from ctx)', async () => {
    const { svc, circlePolicy } = wire();
    const r = await svc.callSkill('set-param', { key: 'nearby.match.minShared', value: 2 }, { circleId: 'c1' });
    expect(r).toMatchObject({ ok: true, scope: 'circle' });
    const policy = await circlePolicy.get('c1');
    expect(policy.settings['nearby.match.minShared']).toBe(2);
  });

  it('the kind gate still refuses internal/unknown even with real homes wired', async () => {
    const { svc, dataSource } = wire();
    expect(await svc.callSkill('set-param', { key: 'nearby.ask.maxText', value: 9999 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });
    const shared = await dataSource.read(svc.settingsModule.SETTINGS_SHARED_PATH);
    expect(shared == null || !JSON.parse(shared)['nearby.ask.maxText']).toBe(true);
  });
});
