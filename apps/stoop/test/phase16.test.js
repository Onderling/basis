/**
 * Stoop V1 — Phase 16 tests.
 *
 * Group ops admin polish: listGroupMembers, postAnnouncement,
 * editGroupRules, removeMember, listReports.  Each gated on the
 * `role` field in MemberMap (admin / coordinator pass; other roles
 * get `error: 'admin-only'`).
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

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

async function buildAgentAs(role) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [
      { webid: ANNE,  role },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── listGroupMembers ──────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listGroupMembers', () => {
  it('returns the MemberMap entries for the current group', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'listGroupMembers');
    expect(r.members.map(m => m.webid).sort()).toEqual([ANNE, BOB, CARLA].sort());
    expect(r.groupId).toBe('oosterpoort');
  });

  // Per-circle scoping (S4): when a group has membership-redemption data, the roster
  // is scoped to that group's redeemers + founders (admin/coordinator).
  it('scopes to a group\'s redeemers + founders when redemption data exists', async () => {
    const bundle = await buildAgentAs('admin');   // ANNE admin (founder), BOB + CARLA members
    await bundle.itemStore.addItems([
      { type: 'membership-redemption', text: 'r', source: { groupId: 'circle-a', redeemedBy: BOB },   visibility: 'household' },
      { type: 'membership-redemption', text: 'r', source: { groupId: 'circle-b', redeemedBy: CARLA }, visibility: 'household' },
    ], { actor: ANNE });

    const a = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-a' });
    expect(a.members.map(m => m.webid).sort()).toEqual([ANNE, BOB].sort());   // BOB redeemed + ANNE founder; NOT CARLA
    const b = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-b' });
    expect(b.members.map(m => m.webid).sort()).toEqual([ANNE, CARLA].sort());
  });

  it('surfaces each joiner\'s sealingPublicKey from the redemption trail (for roster seeding)', async () => {
    const bundle = await buildAgentAs('admin');
    await bundle.itemStore.addItems([
      { type: 'membership-redemption', text: 'r', source: { groupId: 'circle-a', redeemedBy: BOB, sealingPublicKey: 'SEAL-BOB' }, visibility: 'household' },
    ], { actor: ANNE });
    const r = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-a' });
    expect(r.members.find((m) => m.webid === BOB)?.sealingPublicKey).toBe('SEAL-BOB');
    expect(r.members.find((m) => m.webid === ANNE)?.sealingPublicKey).toBeUndefined();   // founder, no redemption
  });

  it('falls back to the full roster when a group has no redemption data (legacy single-circle)', async () => {
    const bundle = await buildAgentAs('admin');
    await bundle.itemStore.addItems([
      { type: 'membership-redemption', text: 'r', source: { groupId: 'circle-a', redeemedBy: BOB }, visibility: 'household' },
    ], { actor: ANNE });
    const r = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'some-other-group' });
    expect(r.members.map(m => m.webid).sort()).toEqual([ANNE, BOB, CARLA].sort());   // no data for that group → unscoped
  });
});

// ── postAnnouncement ─────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — postAnnouncement', () => {
  it('admin can post; item appears with kind:"announcement"', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'Street party zaterdag' });
    expect(r.announcementId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.announcementId);
    expect(item.type).toBe('announcement');
    expect(item.text).toBe('Street party zaterdag');
    expect(item.source.postedBy).toBe(ANNE);
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('coordinator role passes the gate', async () => {
    const bundle = await buildAgentAs('coordinator');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' });
    expect(r.announcementId).toBeTruthy();
  });

  it('rejects empty text', async () => {
    const bundle = await buildAgentAs('admin');
    expect(await callSkill(bundle.agent, 'postAnnouncement', {})).toEqual({ error: 'text required' });
  });
});

// ── editGroupRules ───────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — editGroupRules', () => {
  it('admin can edit rules; new version persists', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'editGroupRules', {
      groupId: 'oosterpoort',
      rules:   { name: 'Oosterpoort', conflictPolicy: 'vote', version: 1 },
    });
    expect(r.rulesId).toBeTruthy();
    const fetched = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'oosterpoort' });
    expect(fetched.rules.source.rules.conflictPolicy).toBe('vote');
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'editGroupRules',
      { groupId: 'oosterpoort', rules: { name: 'x' } });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('rejects missing args', async () => {
    const bundle = await buildAgentAs('admin');
    expect(await callSkill(bundle.agent, 'editGroupRules', { rules: {} }))
      .toEqual({ error: 'groupId required' });
    expect(await callSkill(bundle.agent, 'editGroupRules', { groupId: 'x' }))
      .toEqual({ error: 'rules object required' });
  });
});

// ── removeMember ─────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — removeMember', () => {
  it('admin records a removal item with full source metadata', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', {
      memberWebid: BOB, reason: 'overtreding huisregels',
    });
    expect(r.removalId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.type).toBe('group-removal');
    expect(item.source.memberWebid).toBe(BOB);
    expect(item.source.reason).toBe('overtreding huisregels');
    expect(item.source.removedBy).toBe(ANNE);
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'removeMember', { memberWebid: BOB });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('accepts memberStableId in addition to memberWebid', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', { memberStableId: 'sid-bob' });
    expect(r.removalId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.source.memberStableId).toBe('sid-bob');
  });

  it('rejects when neither identifier is supplied', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', {});
    expect(r).toEqual({ error: 'memberStableId or memberWebid required' });
  });
});

// ── listReports ──────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listReports', () => {
  it('admin sees reports oldest-first', async () => {
    const bundle = await buildAgentAs('admin');
    // Member posts a report (allowed for everyone — this skill is from Phase 3).
    await callSkill(bundle.agent, 'postRequest',
      { text: 'spam-y post', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const open = await bundle.itemStore.listOpen({});
    const post = open.find(i => i.text === 'spam-y post');
    await callSkill(bundle.agent, 'reportPost', { itemId: post.id, reason: 'spam' });

    const r = await callSkill(bundle.agent, 'listReports');
    expect(r.reports.length).toBeGreaterThanOrEqual(1);
    expect(r.reports[0].type).toBe('report');
  });

  it('scopes reports to their circle (a tagged report only shows in its group)', async () => {
    const bundle = await buildAgentAs('admin');
    await callSkill(bundle.agent, 'postRequest', { text: 'p-a', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const post = (await bundle.itemStore.listOpen({})).find((i) => i.text === 'p-a');
    await callSkill(bundle.agent, 'reportPost', { itemId: post.id, reason: 'spam', groupId: 'circle-a' });

    const a = await callSkill(bundle.agent, 'listReports', { groupId: 'circle-a' });
    expect(a.reports.some((r) => r.source?.groupId === 'circle-a')).toBe(true);
    const b = await callSkill(bundle.agent, 'listReports', { groupId: 'circle-b' });
    expect(b.reports.some((r) => r.source?.groupId === 'circle-a')).toBe(false);   // not in another circle
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    expect(await callSkill(bundle.agent, 'listReports')).toEqual({ error: 'admin-only' });
  });
});
