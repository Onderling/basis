/**
 * Pinboard V2 — Phase 23 tests.
 *
 * Profile photo + skills/holiday UI wiring.
 *
 * - 23.1 setMyAvatarUrl / clearMyAvatar round-trip on MemberMap.
 * - 23.4 setHolidayMode / getHolidayMode round-trip; persists.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

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

/* ── 23.4 Holiday mode ─────────────────────────────────────────── */

describe('Pinboard V2 Phase 23.4 — holidayMode', () => {
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
