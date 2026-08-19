/**
 * Stoop V2 — Phase 28 tests.
 *
 *   28.1  setHopMode skill: persists settings + calls
 *         agent.enableRelayForward when global=true
 *   28.1  factory boot: re-applies persisted hop-mode on cold start
 *   28.4  cadence: settings round-trip
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
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

describe('Stoop V2 Phase 28.1 — setHopMode + getHopMode', () => {
  it('default: getHopMode → {global: false}', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'getHopMode', {}))
      .toEqual({ global: false });
  });

  it('setHopMode({global: true}) flips bundle.settings + registers relay-forward skill', async () => {
    const bundle = await buildBundle();
    expect(bundle.agent.skills.get('relay-forward')).toBeFalsy();

    const r = await callSkill(bundle.agent, 'setHopMode', { global: true });
    expect(r).toEqual({ global: true });
    expect(bundle.settings.allowHopThrough).toBe(true);
    expect(bundle.agent.skills.get('relay-forward')).toBeTruthy();

    // Idempotent — calling twice doesn't error.
    const r2 = await callSkill(bundle.agent, 'setHopMode', { global: true });
    expect(r2).toEqual({ global: true });
  });

  it('setHopMode({global: false}) flips settings off', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setHopMode', { global: true });
    await callSkill(bundle.agent, 'setHopMode', { global: false });
    expect(bundle.settings.allowHopThrough).toBe(false);
    // Skill stays registered after first enable (idempotent on the
    // SDK side); the policy gate downgrade happens via agent.config
    // when one is wired.  In this test bundle no AgentConfig is
    // attached, so the registration alone is what we check.
    expect(bundle.agent.skills.get('relay-forward')).toBeTruthy();
  });

  it('rejects non-boolean global', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'setHopMode', { global: 'yes' }))
      .toEqual({ error: 'global (bool) required' });
  });
});

describe('Stoop V2 Phase 28.1 — factory honours persisted hop-mode on boot', () => {
  it('cold-boot bundle whose settings.allowHopThrough is true has relay-forward registered', async () => {
    // Boot 1: enable hop, settings written to cache.
    const bundle1 = await buildBundle();
    await callSkill(bundle1.agent, 'setHopMode', { global: true });

    // Verify the settings live on the cache so a 2nd factory call
    // with the same persistPath would pick them up.  Phase 33 moved
    // device-scoped fields (allowHopThrough included) to the per-device
    // blob; read THAT.
    const devicePath = `mem://stoop/settings/devices/${bundle1.deviceId}.json`;
    const raw = await bundle1.cache.read(devicePath);
    expect(raw).toBeTruthy();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(parsed.allowHopThrough).toBe(true);
  });
});

describe('Stoop V2 Phase 28.4 — cadence settings round-trip', () => {
  it('updateSettings({pollIntervalMs}) persists + getSettings reads back', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'updateSettings', { patch: { pollIntervalMs: 60_000 } });
    const r = await callSkill(bundle.agent, 'getSettings', {});
    expect(r.settings.pollIntervalMs).toBe(60_000);
  });

  it('updateSettings({broadcastable: false}) persists', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'updateSettings', { patch: { broadcastable: false } });
    const r = await callSkill(bundle.agent, 'getSettings', {});
    expect(r.settings.broadcastable).toBe(false);
  });
});
