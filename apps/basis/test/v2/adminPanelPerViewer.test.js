/**
 * The admin panel tells a member the truth: what the GATE refuses them, the panel greys.
 *
 * The panel is every member's roster (they read it; the role control was already decided per viewer). But it offered a
 * member "Remove" on every row — the admin's and their own — and the announcement's "Post", exactly as it did an admin
 * (found 2026-10-08 on a real phone, as a member). Both ops are refused to a member at the skill, so nothing was ever
 * granted; but an offer that always refuses is a lie in the UI.
 *
 * The rule this follows (from the menu's miss): the GATE first, then the UI. So each case below asks the real skill
 * on a real circle — Anne made it, Bob and Carla were admitted — and the panel's decision in the same breath:
 *   · removing someone else: an admin's act (`removeMember` refuses a member) → greyed for a member, with the reason;
 *   · your OWN row as a member: not a removal at all but LEAVING, a member's own act → offered, as "Leave circle";
 *   · the announcement: `postAnnouncement` refuses a member → greyed, with the reason;
 *   · a viewer the roster does not know yet → greyed (fail closed until it answers).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '@onderling-app/stoop';
import { removeControlFor, announceControlFor, policySaveControlFor } from '../../src/v2/circleRoleControl.js';
import { foldPolicyUpdates } from '../../src/v2/policyUpdateLane.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';
const GROUP = 'oosterpoort';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  return agent.skills.get(skillId).handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

/** A device holding a REAL circle (the same shape stoop's own gate tests use): Anne made it, Bob and Carla joined. */
async function buildCircle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
    members: [{ webid: ANNE }, { webid: BOB, stableId: 'sid-bob' }, { webid: CARLA, stableId: 'sid-carla' }],
  });
  await bundle.offeringMatch.start();
  await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'Oosterpoort', rules: {} });
  await bundle.itemStore.addItems([BOB, CARLA].map((w) => ({
    type: 'membership-redemption', text: `${w} joined ${GROUP}`,
    source: { groupId: GROUP, redeemedBy: w, confirmedBy: ANNE }, visibility: 'household',
  })), { actor: ANNE });
  const members = (await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP })).members;
  const row = (w) => members.find((m) => m.webid === w);
  return { bundle, members, row };
}

describe('the admin panel, per viewer — gate first, then the paint', () => {
  it('removing someone else: the gate refuses a member, and the panel greys it for them', async () => {
    const { bundle, members, row } = await buildCircle();
    expect(await callSkill(bundle.agent, 'removeMember', { memberWebid: CARLA }, BOB)).toEqual({ error: 'admin-only' });
    const c = removeControlFor({ members, member: row(CARLA), myRef: BOB });
    expect(c).toMatchObject({ kind: 'remove', disabled: true, reasonKey: 'circle.op.admin_only' });
    // …the admin's own row too: a member cannot remove the admin either
    expect(removeControlFor({ members, member: row(ANNE), myRef: BOB })).toMatchObject({ kind: 'remove', disabled: true });
  });

  it('the admin may remove someone: the gate lets her, and the panel offers it', async () => {
    const { bundle, members, row } = await buildCircle();
    expect(removeControlFor({ members, member: row(CARLA), myRef: ANNE })).toMatchObject({ kind: 'remove', disabled: false });
    const r = await callSkill(bundle.agent, 'removeMember', { memberWebid: CARLA, reason: 'test' }, ANNE);
    expect(r.removalId).toBeTruthy();
  });

  it('a member\'s OWN row is leaving, not a removal — offered, as "Leave circle"', async () => {
    const { members, row } = await buildCircle();
    expect(removeControlFor({ members, member: row(BOB), myRef: BOB }))
      .toMatchObject({ kind: 'leave', disabled: false, labelKey: 'circle.tile.menu.leave' });
  });

  it('the announcement: the gate refuses a member, and the panel greys Post for them; the admin\'s is open', async () => {
    const { bundle, members } = await buildCircle();
    expect(await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' }, BOB)).toEqual({ error: 'admin-only' });
    expect(announceControlFor({ members, myRef: BOB })).toMatchObject({ disabled: true, reasonKey: 'circle.op.admin_only' });
    expect(announceControlFor({ members, myRef: ANNE })).toMatchObject({ disabled: false });
  });

  it('a viewer the roster does not know yet is offered nothing that would refuse (fail closed)', async () => {
    const { members, row } = await buildCircle();
    expect(removeControlFor({ members, member: row(CARLA), myRef: null })).toMatchObject({ disabled: true });
    expect(announceControlFor({ members, myRef: '' })).toMatchObject({ disabled: true });
  });
});

describe('Circle settings\' Save, per viewer — the fold first, then the paint', () => {
  // The circle policy is an ADMIN's signed statement on the governance lane, and every device folds only admins'.
  const stmt = (author, version, policy) => ({ kind: 'policy-update', author, hash: `${author}-${version}`, payload: { policy, version } });

  it('a member\'s policy statement is dropped by the fold — so a member\'s Save is greyed, with the reason', async () => {
    const { members } = await buildCircle();
    const admins = new Set(members.filter((m) => m.role === 'admin').map((m) => m.webid));
    expect(foldPolicyUpdates([stmt(BOB, 2, { features: { tasks: true } })], { admins })).toBeNull();
    expect(policySaveControlFor({ members, myRef: BOB })).toMatchObject({ disabled: true, reasonKey: 'circle.op.admin_only' });
  });

  it('the admin\'s statement is folded — so her Save is open', async () => {
    const { members } = await buildCircle();
    const admins = new Set(members.filter((m) => m.role === 'admin').map((m) => m.webid));
    expect(foldPolicyUpdates([stmt(ANNE, 2, { features: { tasks: true } })], { admins })?.version).toBe(2);
    expect(policySaveControlFor({ members, myRef: ANNE })).toMatchObject({ disabled: false });
  });

  for (const [shell, rel] of [['web', '../../web/v2/circleApp.js'], ['mobile', '../../../basis-mobile/src/screens/v2/CircleSettingsScreen.js']]) {
    it(`${shell} settings asks the decision`, () => {
      expect(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')).toMatch(/policySaveControlFor\(/);
    });
  }
});

describe('both panels paint from the one decision', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [shell, rel] of [['web', '../../web/v2/circleAdminPanel.js'], ['mobile', '../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js']]) {
    it(`${shell}`, () => {
      const src = read(rel);
      expect(src).toMatch(/removeControlFor\(/);
      expect(src).toMatch(/announceControlFor\(/);
      expect(src).toMatch(/onLeave/);
    });
  }
});
