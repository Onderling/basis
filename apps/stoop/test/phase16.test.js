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

/**
 * A device holding a REAL circle: Anne created it, Bob and Carla were admitted through the trail.
 *
 * These tests used to build a MemberMap with a `role` on each row and nothing else — no circle, no
 * creation statement, no admissions — because a role in that map WAS authority. It is not any more:
 * authority is folded from the circle's own record, so a circle has to exist for anyone to be an
 * admin of it. The MemberMap still seeds display facts (names, stableIds), which is all it carries.
 *
 * Anne is the admin because she made the circle. To exercise a non-admin, call as Bob or Carla —
 * which is also more honest than the old `buildAgentAs('member')`, since that asked this device to
 * believe it was a different kind of person rather than asking a different person.
 */
const GROUP = 'oosterpoort';

async function buildCircle({ admitted = [BOB, CARLA] } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
    members: [
      { webid: ANNE },
      { webid: BOB,   stableId: 'sid-bob' },
      { webid: CARLA, stableId: 'sid-carla' },
    ],
  });
  await bundle.offeringMatch.start();
  await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'Oosterpoort', rules: {} });
  await admit(bundle, GROUP, admitted);
  return bundle;
}

/** Admissions as the trail records them: redeemed by the joiner, confirmed by the circle's admin. */
async function admit(bundle, groupId, webids) {
  if (!webids.length) return;
  await bundle.itemStore.addItems(webids.map((w) => ({
    type: 'membership-redemption', text: `${w} joined ${groupId}`,
    source: { groupId, redeemedBy: w, confirmedBy: ANNE },
    visibility: 'household',
  })), { actor: ANNE });
}

// ── listGroupMembers ──────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listGroupMembers', () => {
  it('returns the circle\'s members — its founder and everyone admitted', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'listGroupMembers');
    expect(r.members.map(m => m.webid).sort()).toEqual([ANNE, BOB, CARLA].sort());
    expect(r.groupId).toBe(GROUP);
  });

  // Per-circle scoping (S4): when a group has membership-redemption data, the roster
  // is scoped to that group's redeemers + founders (admin/coordinator).
  it('scopes to a group\'s redeemers + founders when redemption data exists', async () => {
    const bundle = await buildCircle();
    // A founder is now DERIVED — the person who confirmed the admissions — rather than read off a
    // MemberMap role, so these rows carry the `confirmedBy` a real admin-verified redeem writes.
    await admit(bundle, 'circle-a', [BOB]);
    await admit(bundle, 'circle-b', [CARLA]);

    const a = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-a' });
    expect(a.members.map(m => m.webid).sort()).toEqual([ANNE, BOB].sort());   // BOB redeemed + ANNE founder; NOT CARLA
    const b = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-b' });
    expect(b.members.map(m => m.webid).sort()).toEqual([ANNE, CARLA].sort());
  });

  it('surfaces each joiner\'s sealingPublicKey from the redemption trail (for roster seeding)', async () => {
    const bundle = await buildCircle();
    await bundle.itemStore.addItems([
      { type: 'membership-redemption', text: 'r', source: { groupId: 'circle-a', redeemedBy: BOB, confirmedBy: ANNE, sealingPublicKey: 'SEAL-BOB' }, visibility: 'household' },
    ], { actor: ANNE });
    const r = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-a' });
    expect(r.members.find((m) => m.webid === BOB)?.sealingPublicKey).toBe('SEAL-BOB');
    expect(r.members.find((m) => m.webid === ANNE)?.sealingPublicKey).toBeUndefined();   // founder, no redemption
  });

  // The inverse of what this used to assert. It pinned a fallback: a circle this device held no
  // record of returned the FULL MemberMap — the global display cache — so asking about a circle you
  // were not in answered with everyone you had ever met, and named you a member of it. That fallback
  // is gone. No record of a circle is not a smaller circle; it is no answer.
  it('a circle this device has no record of returns NOTHING, not the whole address book', async () => {
    const bundle = await buildCircle();
    await admit(bundle, 'circle-a', [BOB]);
    const r = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'some-other-group' });
    expect(r.members).toEqual([]);
    expect(r.reason).toBe('not-a-member');
  });
});

// ── postAnnouncement ─────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — postAnnouncement', () => {
  it('admin can post; item appears with kind:"announcement"', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'Street party zaterdag' });
    expect(r.announcementId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.announcementId);
    expect(item.type).toBe('announcement');
    expect(item.text).toBe('Street party zaterdag');
    expect(item.source.postedBy).toBe(ANNE);
  });

  it('a member of the circle gets admin-only', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' }, BOB);
    expect(r).toEqual({ error: 'admin-only' });
  });

  // What this used to assert — "a coordinator passes the gate" — can no longer be asked here. The
  // gate reads the membership FOLD, and the fold mints `admin` and `member` and nothing else, so no
  // circle can hand anyone the coordinator rank to be tested with. The rank still exists in the
  // predicate (`isCircleAdmin` admits coordinator and above); it is pinned in the role-rank tests
  // that own that predicate, which is where it belongs now that it is not reachable through a gate.

  it('rejects empty text', async () => {
    const bundle = await buildCircle();
    expect(await callSkill(bundle.agent, 'postAnnouncement', {})).toEqual({ error: 'text required' });
  });
});

// ── editGroupRules ───────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — editGroupRules', () => {
  it('admin can edit rules; new version persists', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'editGroupRules', {
      groupId: 'oosterpoort',
      rules:   { name: 'Oosterpoort', conflictPolicy: 'vote', version: 1 },
    });
    expect(r.rulesId).toBeTruthy();
    const fetched = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'oosterpoort' });
    expect(fetched.rules.source.rules.conflictPolicy).toBe('vote');
  });

  it('a member of the circle gets admin-only', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'editGroupRules',
      { groupId: GROUP, rules: { name: 'x' } }, BOB);
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('rejects missing args', async () => {
    const bundle = await buildCircle();
    expect(await callSkill(bundle.agent, 'editGroupRules', { rules: {} }))
      .toEqual({ error: 'groupId required' });
    expect(await callSkill(bundle.agent, 'editGroupRules', { groupId: 'x' }))
      .toEqual({ error: 'rules object required' });
  });
});

// ── removeMember ─────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — removeMember', () => {
  it('admin records a removal item with full source metadata', async () => {
    const bundle = await buildCircle();
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
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'removeMember', { memberWebid: CARLA }, BOB);
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('accepts memberStableId in addition to memberWebid', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'removeMember', { memberStableId: 'sid-bob' });
    expect(r.removalId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.source.memberStableId).toBe('sid-bob');
  });

  it('rejects when neither identifier is supplied', async () => {
    const bundle = await buildCircle();
    const r = await callSkill(bundle.agent, 'removeMember', {});
    expect(r).toEqual({ error: 'memberStableId or memberWebid required' });
  });
});

// ── listReports ──────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listReports', () => {
  it('admin sees reports oldest-first', async () => {
    const bundle = await buildCircle();
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
    const bundle = await buildCircle();
    // Reports are admin-only per circle, so Anne has to actually be an admin of the two circles
    // this scopes across — which now means the circles have to exist and name her.
    await admit(bundle, 'circle-a', [BOB]);
    await admit(bundle, 'circle-b', [CARLA]);
    await callSkill(bundle.agent, 'postRequest', { text: 'p-a', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const post = (await bundle.itemStore.listOpen({})).find((i) => i.text === 'p-a');
    await callSkill(bundle.agent, 'reportPost', { itemId: post.id, reason: 'spam', groupId: 'circle-a' });

    const a = await callSkill(bundle.agent, 'listReports', { groupId: 'circle-a' });
    expect(a.reports.some((r) => r.source?.groupId === 'circle-a')).toBe(true);
    const b = await callSkill(bundle.agent, 'listReports', { groupId: 'circle-b' });
    expect(b.reports.some((r) => r.source?.groupId === 'circle-a')).toBe(false);   // not in another circle
  });

  it('a member of the circle gets admin-only', async () => {
    const bundle = await buildCircle();
    expect(await callSkill(bundle.agent, 'listReports', {}, BOB)).toEqual({ error: 'admin-only' });
  });
});
