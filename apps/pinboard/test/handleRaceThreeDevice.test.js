/**
 * Joiners who pick the same name AT THE SAME TIME (story 2.1 of the multi-device user stories).
 *
 * The name was once unique per circle, and this file proved one winner under the race. Since 2026-11-06 the name is
 * for people and two people may share one (uniqueness stays on the key; the members list tells two equal names apart
 * with a small number). What still matters under the race: every joiner lands exactly once, under their own key,
 * with the name they chose, and none is refused for the name.
 *
 * Cast: Anna (admin, owns the roster) · Bram, Cato and Dirk (all want "Jan").
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB = 'https://id.example/bob';
const CAROL = 'https://id.example/carol';
const DAVE = 'https://id.example/dave';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ANNE], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle({ group = GROUP, members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group, localActor: ANNE, peers: [] },
    members: members ?? [{ webid: ANNE, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function adminWithCode() {
  const bundle = await buildBundle();
  const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES }, ANNE);
  return { bundle, code: r.code };
}

/** The handles actually recorded on the roster's redemption trail, case-folded. */
async function claimedHandles(bundle) {
  const reds = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
  return reds.map((i) => i?.source?.peerDisplay).filter(Boolean).map((h) => h.toLowerCase());
}

describe('2.1 — joiners redeem the same invite at once and all pick "Jan"', () => {
  it('both concurrent joiners land, each once, under their own key, both called Jan', async () => {
    const { bundle, code } = await adminWithCode();
    const [bram, cato] = await Promise.all([
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'Jan' }, ANNE),
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: CAROL, peerDisplay: 'Jan' }, ANNE),
    ]);
    expect([bram, cato].filter((r) => r.error)).toHaveLength(0);
    const reds = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    const mine = reds.filter((i) => i?.source?.groupId === GROUP);
    expect(mine.map((i) => i.source.redeemedBy).sort()).toEqual([BOB, CAROL].sort());   // each once
    expect((await claimedHandles(bundle)).filter((h) => h === 'jan')).toHaveLength(2);
  });

  it('THREE at once: all three land', async () => {
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([BOB, CAROL, DAVE].map((who) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: who, peerDisplay: 'Jan' }, ANNE)));
    expect(results.filter((r) => r.error)).toHaveLength(0);
    expect((await claimedHandles(bundle)).filter((h) => h === 'jan')).toHaveLength(3);
  });

  it('the race is only for the SAME handle — different handles all succeed concurrently', async () => {
    // The control. If the fix serialised every join, this would still pass but the circle would have become
    // needlessly sequential; asserting all three land keeps the guard honest about what it may cost.
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([[BOB, 'jan'], [CAROL, 'piet'], [DAVE, 'klaas']].map(([who, h]) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: who, peerDisplay: h }, ANNE)));

    expect(results.filter((r) => r.error)).toHaveLength(0);
    expect((await claimedHandles(bundle)).sort()).toEqual(['jan', 'klaas', 'piet']);
  });

  it('names are kept as typed — "jan", "Jan" and "JAN" all land as written', async () => {
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([[BOB, 'jan'], [CAROL, 'Jan'], [DAVE, 'JAN']].map(([who, h]) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: who, peerDisplay: h }, ANNE)));
    expect(results.filter((r) => r.error)).toHaveLength(0);
    const reds = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    expect(reds.map((i) => i?.source?.peerDisplay).filter(Boolean).sort()).toEqual(['JAN', 'Jan', 'jan']);
  });

  it('a joiner re-sending their OWN claim concurrently is not a self-collision', async () => {
    // A retry over a flaky relay duplicates the request. The joiner must not lose to themselves.
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([1, 2, 3].map(() =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { rulesAccepted: '1', groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE)));

    expect(results.filter((r) => r.error)).toHaveLength(0);          // every retry accepted
    expect((await claimedHandles(bundle)).filter((h) => h === 'jan').length).toBeGreaterThan(0);
  });
});
