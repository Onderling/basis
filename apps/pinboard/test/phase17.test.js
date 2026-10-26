/**
 * Pinboard V1 — Phase 17 tests.
 *
 * Onboarding polish: getInviteQrPayload.
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

async function buildAgent() {
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

// ── getInviteQrPayload ───────────────────────────────────────────────────

describe('Pinboard V1 Phase 17 — getInviteQrPayload', () => {
  it('round-trips an invite as base64url under onderling-invite://', async () => {
    const bundle = await buildAgent();
    const invite = { groupId: 'oosterpoort', adminPubKey: 'abc', nonce: 'xyz' };
    const r = await callSkill(bundle.agent, 'getInviteQrPayload', { invite });
    expect(r.payload).toMatch(/^onderling-invite:\/\//);
    const b64 = r.payload.replace(/^onderling-invite:\/\//, '');
    // Decode + parse → matches the original invite.
    const std = b64.replaceAll('-', '+').replaceAll('_', '/');
    const pad = std + '='.repeat((4 - std.length % 4) % 4);
    const json = (typeof atob === 'function')
      ? atob(pad)
      : Buffer.from(pad, 'base64').toString('binary');
    expect(JSON.parse(json)).toEqual(invite);
  });

  it('rejects missing invite', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'getInviteQrPayload', {}))
      .toEqual({ error: 'invite required' });
  });
});

