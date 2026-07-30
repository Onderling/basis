/**
 * Stoop V1 — Phase 17 tests.
 *
 * Onboarding polish: getMnemonicOnce, getInviteQrPayload, gated
 * redeemInviteWithGate.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';

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
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── getMnemonicOnce ──────────────────────────────────────────────────────

describe('Stoop V1 Phase 17 — getMnemonicOnce', () => {
  it('first call returns the mnemonic + flips shown; second call returns shown:true', async () => {
    const bundle = await buildAgent();
    const r1 = await callSkill(bundle.agent, 'getMnemonicOnce');
    expect(r1.shown).toBe(false);
    expect(typeof r1.mnemonic).toBe('string');
    expect(r1.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12);

    const r2 = await callSkill(bundle.agent, 'getMnemonicOnce');
    expect(r2.shown).toBe(true);
    expect(r2.mnemonic).toBeNull();
  });

  it('atomic mark-shown survives a re-issued skill call', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'getMnemonicOnce');
    const me = await bundle.members.resolveByWebid(ANNE);
    expect(me.externalIds.mnemonicShown).toBe('true');
  });
});

// ── getInviteQrPayload ───────────────────────────────────────────────────

describe('Stoop V1 Phase 17 — getInviteQrPayload', () => {
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

// ── redeemInviteWithGate ─────────────────────────────────────────────────

describe('Stoop V1 Phase 17 — redeemInviteWithGate', () => {
  it('rejects without privacy acceptance', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'redeemInviteWithGate', {
      invite: { groupId: 'oosterpoort' },
      rulesAccepted: true,
      privacyAccepted: false,
    });
    expect(r).toEqual({ error: 'privacy-not-accepted' });
  });

  it('rejects without rules acceptance', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'redeemInviteWithGate', {
      invite: { groupId: 'oosterpoort' },
      privacyAccepted: true,
      rulesAccepted: false,
    });
    expect(r).toEqual({ error: 'rules-not-accepted' });
  });

  it('accepts both gates → records audit item + returns ok', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'redeemInviteWithGate', {
      invite: { groupId: 'oosterpoort' },
      privacyAccepted: true,
      rulesAccepted: true,
    });
    expect(r.ok).toBe(true);
    expect(r.acceptanceId).toBeTruthy();

    const item = await bundle.itemStore.getById(r.acceptanceId);
    expect(item.type).toBe('rules-accept');
    expect(item.source.gateVersion).toBe('phase-17');
    expect(item.source.acceptedBy).toBe(ANNE);
  });

  it('rejects missing invite', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'redeemInviteWithGate', {
      privacyAccepted: true, rulesAccepted: true,
    });
    expect(r).toEqual({ error: 'invite required' });
  });
});
