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

// ── mutePeer migration ────────────────────────────────────────────────────

describe('Stoop V1 Phase 11 — mutePeer by stableId (with webid back-compat)', () => {
  it('mutes by peerStableId when supplied', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'mutePeer', { peerStableId: 'sid-bob-42' });
    expect(r).toMatchObject({ muted: 'sid-bob-42' });
    expect(bundle.muted.has('sid-bob-42')).toBe(true);
  });

  it('webid-only mute resolves to stableId via MemberMap when known', async () => {
    const bundle = await buildAgent({
      members: [
        { webid: ANNE },
        { webid: BOB, stableId: 'sid-bob-known' },
      ],
    });
    const r = await callSkill(bundle.agent, 'mutePeer', { peerWebid: BOB });
    expect(r).toMatchObject({ muted: 'sid-bob-known' });
    expect(bundle.muted.has('sid-bob-known')).toBe(true);
  });

  it('webid-only mute falls back to webid when MemberMap has no stableId', async () => {
    const bundle = await buildAgent({
      members: [{ webid: ANNE }, { webid: BOB }],   // BOB has no stableId
    });
    const r = await callSkill(bundle.agent, 'mutePeer', { peerWebid: BOB });
    expect(r).toMatchObject({ muted: BOB });
    expect(bundle.muted.has(BOB)).toBe(true);
  });

  it('unmute round-trips via the same key resolution', async () => {
    const bundle = await buildAgent({
      members: [{ webid: ANNE }, { webid: BOB, stableId: 'sid-bob' }],
    });
    await callSkill(bundle.agent, 'mutePeer',   { peerWebid: BOB });
    const u = await callSkill(bundle.agent, 'unmutePeer', { peerWebid: BOB });
    expect(u).toMatchObject({ unmuted: 'sid-bob', had: true });
    expect(bundle.muted.has('sid-bob')).toBe(false);
  });

  it('error when neither identifier supplied', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'mutePeer', {}))
      .toEqual({ error: 'peerStableId or peerWebid required' });
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
