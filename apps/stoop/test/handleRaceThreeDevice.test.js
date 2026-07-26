/**
 * Two joiners claim the same handle AT THE SAME TIME — story 2.1 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * `handleUniqueness.test.js` already proves the rule SEQUENTIALLY: Bram takes `jan`, then Cato is refused.
 * That is the easy half. The story is about ORDERING — Bram and Cato redeem the same invite and both pick
 * `@jan`, and their requests reach the admin interleaved. The rule is only worth anything if it survives
 * that, because a duplicate handle inside one circle is unresolvable after the fact: there is no
 * disambiguation by design (`NOTE-identity-and-linkability.md`, 2026-07-24), so the roster is simply wrong
 * and two people answer to one name.
 *
 * This is the same shape as the four clobber bugs this corpus has already found — read the current state,
 * decide, then write, with the two steps not atomic — applied to identity instead of keys.
 *
 * Cast: Anna (admin, owns the roster) · Bram and Cato (both want `@jan`) · Dirk (a bystander).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB = 'https://id.example/bob';
const CAROL = 'https://id.example/carol';
const DAVE = 'https://id.example/dave';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'buurt', admins: [ANNE], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle({ group = GROUP, members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
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

describe('2.1 — two joiners redeem the same invite and both pick @jan', () => {
  it('exactly ONE of two concurrent claims wins; the roster holds no duplicate', async () => {
    const { bundle, code } = await adminWithCode();

    // Both requests are in flight before either has written — the ordering the story is about. A relay
    // delivering two group-redeem-requests back to back produces exactly this.
    const [bram, cato] = await Promise.all([
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE),
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: CAROL, peerDisplay: 'jan' }, ANNE),
    ]);

    const won = [bram, cato].filter((r) => !r.error);
    const lost = [bram, cato].filter((r) => r.error);
    expect(won).toHaveLength(1);                       // exactly one — not zero, not both
    expect(lost).toHaveLength(1);
    expect(lost[0].error).toBe('handle-taken');        // …and the loser is told WHY, so they can pick again

    // The durable roster is the real subject: one `jan`, never two.
    const handles = await claimedHandles(bundle);
    expect(handles.filter((h) => h === 'jan')).toHaveLength(1);
  });

  it('the LOSER left no trace — a refused join must not half-write a member', async () => {
    const { bundle, code } = await adminWithCode();
    const [bram, cato] = await Promise.all([
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE),
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: CAROL, peerDisplay: 'jan' }, ANNE),
    ]);
    const loserWebid = bram.error ? BOB : CAROL;

    const reds = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    expect(reds.some((i) => i?.source?.redeemedBy === loserWebid)).toBe(false);
    expect(reds.filter((i) => i?.source?.groupId === GROUP)).toHaveLength(1);
  });

  it('THREE at once still yields exactly one winner', async () => {
    // Two could pass by luck on a lock that only serialises pairs; three makes that much less likely.
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([BOB, CAROL, DAVE].map((who) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: who, peerDisplay: 'jan' }, ANNE)));

    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error === 'handle-taken')).toHaveLength(2);
    expect((await claimedHandles(bundle)).filter((h) => h === 'jan')).toHaveLength(1);
  });

  it('the race is only for the SAME handle — different handles all succeed concurrently', async () => {
    // The control. If the fix serialised every join, this would still pass but the circle would have become
    // needlessly sequential; asserting all three land keeps the guard honest about what it may cost.
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([[BOB, 'jan'], [CAROL, 'piet'], [DAVE, 'klaas']].map(([who, h]) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: who, peerDisplay: h }, ANNE)));

    expect(results.filter((r) => r.error)).toHaveLength(0);
    expect((await claimedHandles(bundle)).sort()).toEqual(['jan', 'klaas', 'piet']);
  });

  it('case-folding holds under the race — `Jan` and `jan` are one claim', async () => {
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([[BOB, 'jan'], [CAROL, 'Jan'], [DAVE, 'JAN']].map(([who, h]) =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: who, peerDisplay: h }, ANNE)));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect((await claimedHandles(bundle))).toHaveLength(1);
  });

  it('a joiner re-sending their OWN claim concurrently is not a self-collision', async () => {
    // A retry over a flaky relay duplicates the request. The joiner must not lose to themselves.
    const { bundle, code } = await adminWithCode();
    const results = await Promise.all([1, 2, 3].map(() =>
      callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE)));

    expect(results.filter((r) => r.error)).toHaveLength(0);          // every retry accepted
    expect((await claimedHandles(bundle)).filter((h) => h === 'jan').length).toBeGreaterThan(0);
  });
});

describe('2.1 — the same race on `setMyHandle` (an existing member renaming)', () => {
  it('two members renaming to the same handle at once: exactly one wins', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighborhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
      members: [{ webid: ANNE }, { webid: BOB }, { webid: CAROL }],
    });
    await bundle.offeringMatch.start();

    const [bob, carol] = await Promise.all([
      callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, BOB),
      callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, CAROL),
    ]);

    expect([bob, carol].filter((r) => !r.error)).toHaveLength(1);
    expect([bob, carol].filter((r) => r.reason === 'handle-taken')).toHaveLength(1);

    // And the MemberMap — the thing every other surface reads — holds one `jan`.
    const rows = await Promise.all([BOB, CAROL].map((w) => bundle.members.resolveByWebid(w)));
    expect(rows.filter((m) => (m?.handle ?? '').toLowerCase() === 'jan')).toHaveLength(1);
  });
});
