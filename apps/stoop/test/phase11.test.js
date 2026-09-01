/**
 * Stoop V1 — Phase 11 tests.
 *
 * stableId in agent identity, skills schema, mute-by-stableId
 * migration, profile-skill management skills.  All compose
 * existing primitives — no substrate change beyond the additive
 * MemberMap fields done in 11.2/11.3.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

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

async function buildAgent({ members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    members ?? [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── Skill management ──────────────────────────────────────────────────────

describe('Stoop V1 Phase 11 — setMyOfferings / addMySkill / removeMySkill', () => {
  it('setMyOfferings replaces the full array', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'setMyOfferings', {
      skills: [
        { categoryId: 'klusjes', freeTags: ['fiets'] },
        { categoryId: 'tuin' },
      ],
    });
    expect(r.skills).toHaveLength(2);
    expect(r.skills[0].categoryId).toBe('klusjes');
    expect(r.skills[1].status).toBe('active');     // default
  });

  it('addMySkill upserts by categoryId', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'klusjes', freeTags: ['fiets'] });
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'klusjes', freeTags: ['paint'] });
    const list = await callSkill(bundle.agent, 'listMySkills');
    expect(list.skills).toHaveLength(1);
    expect(list.skills[0].freeTags).toEqual(['paint']);   // overwritten
  });

  it('removeMySkill drops by categoryId', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'klusjes' });
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'tuin' });
    await callSkill(bundle.agent, 'removeMySkill', { categoryId: 'klusjes' });
    const list = await callSkill(bundle.agent, 'listMySkills');
    expect(list.skills.map(s => s.categoryId)).toEqual(['tuin']);
  });

  it('rejects missing required args', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'setMyOfferings', {})).toEqual({ error: 'skills array required' });
    expect(await callSkill(bundle.agent, 'addMySkill', {})).toEqual({ error: 'categoryId required' });
    expect(await callSkill(bundle.agent, 'removeMySkill', {})).toEqual({ error: 'categoryId required' });
  });
});

// ── stableId end-to-end through the agent factory ─────────────────────────

describe('Stoop V1 Phase 11 — stableId reaches the bundle', () => {
  it('bundle.agent.identity.stableId is non-null + survives offeringMatch start', async () => {
    const bundle = await buildAgent();
    const sid = bundle.agent.identity.stableId;
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
  });
});
