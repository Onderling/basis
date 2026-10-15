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

// (the per-person offering writers set/add/remove retired 2026-10-15 — offerings are the person's drivers)

describe('Stoop V1 Phase 11 — stableId reaches the bundle', () => {
  it('bundle.agent.identity.stableId is non-null + survives offeringMatch start', async () => {
    const bundle = await buildAgent();
    const sid = bundle.agent.identity.stableId;
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
  });
});
