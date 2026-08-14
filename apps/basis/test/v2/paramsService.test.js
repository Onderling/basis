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

  it('list-user-params projects only the settable (kind:user) slice (the settings-form seed)', async () => {
    const svc = createParamsService();
    const { params } = await svc.callSkill('list-user-params');
    // The kind:user params basis governs today (the history-mirror switch + the instant-restore
    // recency window joined with the personal history store — all flipped through this same gate).
    expect(params.map((p) => p.key).sort()).toEqual([
      'calendarEmission.defaultDurationMin', 'history.mirror',
      'history.restore.maxPerCircle', 'history.restore.recencyDays',
      'nearby.ask.defaultTtlMs', 'onlineCadence.pollIntervalMs',
      'privacy.shareNknAddress', 'surface.pref', 'transport.mode', 'wake.nudges',
    ]);
    // Both are kind:user; internal caps are never here.
    expect(params.every((p) => ['agent', 'device'].includes(p.scope))).toBe(true);
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

// ── hydrate: the READ side round-trips the user stories (set → persist → reboot/other-device → read) ─────────
describe('hydrate round-trips the params user stories', () => {
  const regAllScopes = () => basisParamRegistry([
    { key: 'catchup.pollIntervalMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 5000 },
    { key: 'nearby.match.minShared', scope: PARAM_SCOPE.CIRCLE, kind: PARAM_KIND.USER, default: 1 },
  ]);
  const circlePolicyStore = () => {
    const m = new Map();
    return createCirclePolicyStore({ load: (id) => m.get(id) ?? null, save: (id, v) => { m.set(id, v); } });
  };

  it('S6 — round-trip after "reboot": set → fresh register hydrates → the value survives', async () => {
    const dataSource = memoryDataSource();
    const a = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-1' });
    await a.callSkill('set-param', { key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 });
    const b = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-1' });   // fresh boot
    expect((await b.callSkill('get-param', { key: 'nearby.ask.defaultTtlMs' })).value).toBe(30 * 60_000); // default pre-hydrate
    await b.hydrate();
    expect((await b.callSkill('get-param', { key: 'nearby.ask.defaultTtlMs' })).value).toBe(10 * 60_000); // synced post-hydrate
  });

  it('S1 — agent scope SYNCS across the user\'s devices (shared.json)', async () => {
    const dataSource = memoryDataSource();
    const a = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-A' });
    await a.callSkill('set-param', { key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 });
    const b = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-B' });   // 2nd device, same pod
    await b.hydrate();
    expect((await b.callSkill('get-param', { key: 'nearby.ask.defaultTtlMs' })).value).toBe(10 * 60_000);
  });

  it('S2 — device scope is LOCAL-ONLY (does not cross to another device)', async () => {
    const dataSource = memoryDataSource();
    const a = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-A' });
    await a.callSkill('set-param', { key: 'catchup.pollIntervalMs', value: 3000 });
    const b = createParamsService({ register: regAllScopes(), dataSource, deviceId: 'dev-B' });
    await b.hydrate();
    expect((await b.callSkill('get-param', { key: 'catchup.pollIntervalMs' })).value).toBe(5000);   // B keeps its default
  });

  it('S3 — circle scope: set on one member, read on another via the circle policy', async () => {
    const circlePolicy = circlePolicyStore();
    const a = createParamsService({ register: regAllScopes(), circlePolicy });
    await a.callSkill('set-param', { key: 'nearby.match.minShared', value: 2 }, { circleId: 'c1' });
    const b = createParamsService({ register: regAllScopes(), circlePolicy });
    await b.hydrate({ circleId: 'c1' });
    expect((await b.callSkill('get-param', { key: 'nearby.match.minShared' })).value).toBe(2);
  });
});
