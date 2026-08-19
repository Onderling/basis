/**
 * Stoop V2 — Phase 23 tests.
 *
 * Profile photo + skills/holiday UI wiring + Settings page +
 * pod-sync coverage.
 *
 * - 23.1 setMyAvatarUrl / clearMyAvatar round-trip on MemberMap.
 * - 23.4 setHolidayMode / getHolidayMode round-trip; persists.
 * - 23.5 getSettings returns defaults; updateSettings patches; persists.
 * - 23.6 settings flush to a stubbed pod source on attachInner.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import { DEFAULT_SETTINGS } from '../src/lib/Settings.js';

const ANNE = 'https://id.example/anne';

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

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/* ── 23.1 Avatar wiring ────────────────────────────────────────── */

describe('Stoop V2 Phase 23.1 — avatarUrl wiring', () => {
  it('setMyAvatarUrl persists to MemberMap; getMyProfile reads it back', async () => {
    const bundle = await buildBundle();
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ';   // truncated stub
    const r = await callSkill(bundle.agent, 'setMyAvatarUrl', { url: dataUrl });
    expect(r.avatarUrl).toBe(dataUrl);

    const me = await callSkill(bundle.agent, 'getMyProfile', {});
    expect(me.entry.avatarUrl).toBe(dataUrl);
  });

  it('clearMyAvatar resets to null', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyAvatarUrl', { url: 'data:image/jpeg;base64,xxx' });
    const r = await callSkill(bundle.agent, 'clearMyAvatar', {});
    expect(r.cleared).toBe(true);
    const me = await callSkill(bundle.agent, 'getMyProfile', {});
    expect(me.entry.avatarUrl).toBeNull();
  });

  it('rejects missing url', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'setMyAvatarUrl', {})).toEqual({ error: 'url required' });
  });
});

/* ── 23.4 Holiday mode ─────────────────────────────────────────── */

describe('Stoop V2 Phase 23.4 — holidayMode', () => {
  it('default is false', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'getHolidayMode', {});
    expect(r.holidayMode).toBe(false);
  });

  it('setHolidayMode({on: true}) flips the flag; persists on MemberMap entry', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'setHolidayMode', { on: true });
    expect(r.holidayMode).toBe(true);

    const me = await callSkill(bundle.agent, 'getMyProfile', {});
    expect(me.entry.holidayMode).toBe(true);
  });

  // availability unification: the op is now a THIN SHIM over the unified
  // `availability` property — holiday IS the coarse 'away' value.
  it('setHolidayMode is a shim: sets availability to away/open on the entry', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setHolidayMode', { on: true });
    let me = await callSkill(bundle.agent, 'getMyProfile', {});
    expect(me.entry.availability).toBe('away');

    await callSkill(bundle.agent, 'setHolidayMode', { on: false });
    me = await callSkill(bundle.agent, 'getMyProfile', {});
    expect(me.entry.availability).toBe('open');
    // getHolidayMode derives holiday from availability === 'away'
    expect((await callSkill(bundle.agent, 'getHolidayMode', {})).holidayMode).toBe(false);
  });

  it('rejects non-boolean `on`', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'setHolidayMode', { on: 'yes' }))
      .toEqual({ error: 'on (bool) required' });
  });
});

/* ── 23.5 Settings ─────────────────────────────────────────────── */

describe('Stoop V2 Phase 23.5 — getSettings / updateSettings', () => {
  it('cold-boot returns DEFAULT_SETTINGS', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'getSettings', {});
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('updateSettings patches a subset; remaining defaults preserved', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'updateSettings', {
      patch: { broadcastable: false, allowHopThrough: true },
    });
    expect(r.settings.broadcastable).toBe(false);
    expect(r.settings.allowHopThrough).toBe(true);
    expect(r.settings.pollIntervalMs).toBe(DEFAULT_SETTINGS.pollIntervalMs);
    expect(bundle.metrics.snapshot()['settings-updated']?.count).toBe(1);
  });

  it('updateSettings nested onlineWindow merges (does not wipe untouched field)', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'updateSettings', {
      patch: { onlineWindow: { everyMinutes: 60 } },
    });
    const r = await callSkill(bundle.agent, 'updateSettings', {
      patch: { onlineWindow: { durationSec: 120 } },
    });
    expect(r.settings.onlineWindow.everyMinutes).toBe(60);
    expect(r.settings.onlineWindow.durationSec).toBe(120);
  });

  it('updateSettings rejects missing patch', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'updateSettings', {}))
      .toEqual({ error: 'patch (object) required' });
  });

  it('settings persist on bundle.settings field after updateSettings', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'updateSettings', { patch: { allowHopThrough: true } });
    expect(bundle.settings.allowHopThrough).toBe(true);
  });
});

/* ── 23.6 Pod-sync coverage ────────────────────────────────────── */

describe('Stoop V2 Phase 23.6 — settings flush to pod on attach', () => {
  it('settings updated AFTER pod attach flush through to the inner', async () => {
    // Note: today's CachingDataSource only enqueues writes when an
    // inner is attached; pre-sign-in settings stay local-only until
    // Phase 29 adds bulk-sync-on-attach.  This test pins the
    // currently-correct behaviour: post-sign-in settings DO flow to
    // the pod through the standard write-through path.
    const bundle = await buildBundle();
    expect(bundle.cache.hasInner).toBe(false);

    const writes = [];
    const stubPod = {
      async read()           { return null; },
      async write(path, data) { writes.push({ path, data }); },
      async delete()          { },
      async list()            { return []; },
    };
    await bundle.cache.attachInner(stubPod);
    expect(bundle.cache.hasInner).toBe(true);

    // Update settings AFTER attach.  Phase 33 splits the blob into
    // shared (broadcastable) + per-device (allowHopThrough); Phase 34
    // marks the device blob as localOnly so it stays off the pod.
    // Therefore: shared.json hits the inner; device blob does NOT.
    await callSkill(bundle.agent, 'updateSettings', {
      patch: { allowHopThrough: true, broadcastable: false },
    });

    const sharedWrites = writes.filter(w => w.path === 'mem://stoop/settings/shared.json');
    const devicePath   = `mem://stoop/settings/devices/${bundle.deviceId}.json`;
    const deviceWrites = writes.filter(w => w.path === devicePath);
    expect(sharedWrites.length).toBeGreaterThan(0);
    expect(deviceWrites.length).toBe(0);    // Phase 34: localOnly, never crosses to pod

    const sharedParsed = JSON.parse(sharedWrites[sharedWrites.length - 1].data);
    expect(sharedParsed.broadcastable).toBe(false);
    // Device blob is still readable locally — sanity check.
    const deviceLocal = JSON.parse(await bundle.cache.read(devicePath));
    expect(deviceLocal.allowHopThrough).toBe(true);
  });
});
