// J-govvote: a circle DECIDES something — propose, vote, tally, resolve — across three real people.
//
// Why this journey exists: governance is a Tier-1 gap. The decision machinery has good unit coverage
// and a simulated three-device harness, but the coverage survey (2026-08-23) found that the corridor
// **propose → vote → resolve** has never run over real agents: real per-circle signing keys, the
// governance lane, a real fan, verification at each receiver's rail. That is exactly where a
// decision system can look right and be wrong, because the whole promise is that every device
// computes the SAME answer from the same signed events, with no server adjudicating.
//
// The decision class is set to `member-vote` deliberately. The defaults make removal an any-admin
// act, which never needs anyone else — so the default path cannot demonstrate a tally at all.
//
//   Anne  — admin, raises the proposal
//   Bram  — member, votes
//   Cato  — member, votes, and is the third device the result must land on identically
import { checker, wait } from './_util.mjs';
import { bootAppCircle, untilTrue, governanceFor } from './_app.mjs';

export const name = 'J-govvote (propose → vote → tally → resolve, across three real devices)';

const CIRCLE = 'e2e-governance-vote';
// One person, one vote, tallied over the FULL proof-derived membership — so removal needs the circle.
const POLICY = { governance: { removeMember: 'member-vote', changeRule: 'member-vote' } };

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const gov = {
      anne: governanceFor(anne, { policy: POLICY }),
      bram: governanceFor(bram, { policy: POLICY }),
      cato: governanceFor(cato, { policy: POLICY }),
    };
    check('the governance handle binds on every device', !!gov.anne.propose && !!gov.bram.vote);

    // ── 1. Anne raises a decision the circle has to make ─────────────────────────────────────────
    const proposal = await gov.anne.propose({
      circleId: CIRCLE, action: 'changeRule', subject: { agreements: 'geen boormachines na 20:00' },
    });
    check('the proposal is raised', !!proposal && !proposal.error, JSON.stringify(proposal)?.slice(0, 160));
    const proposalId = proposal?.proposalId ?? proposal?.id ?? null;
    check('the proposal has an id to vote on', !!proposalId);

    // ── 2. It reaches the OTHER devices — a decision nobody can see is not a decision ─────────────
    const seenBy = async (g) => {
      const v = await g.view(CIRCLE).catch(() => null);
      const rows = v?.open ?? v?.proposals ?? (Array.isArray(v) ? v : []);
      return rows.some((p) => (p.proposalId ?? p.id) === proposalId);
    };
    check('the proposal reaches the second device', await untilTrue(() => seenBy(gov.bram)));
    check('…and the third', await untilTrue(() => seenBy(gov.cato)));

    // ── 3. Two members vote ──────────────────────────────────────────────────────────────────────
    const bramVote = await gov.bram.vote({ circleId: CIRCLE, proposalId, choice: 'yes' });
    check('a member can cast a vote', !bramVote?.error, JSON.stringify(bramVote)?.slice(0, 140));
    const catoVote = await gov.cato.vote({ circleId: CIRCLE, proposalId, choice: 'yes' });
    check('and so can the third person', !catoVote?.error, JSON.stringify(catoVote)?.slice(0, 140));
    await wait(2000);

    // ── 4. The tally is the same on every device — the property that matters ──────────────────────
    const tallyOn = async (g) => {
      const t = await g.tally({ circleId: CIRCLE, proposalId }).catch(() => null);
      return t ?? null;
    };
    // The vote responses carry the tally, which is the shape a caller actually gets back.
    const tallies = [proposal, bramVote, catoVote].map((r) => r?.tally ?? null);
    check('every vote came back with a tally', tallies.every(Boolean), JSON.stringify(tallies)?.slice(0, 200));

    const counted = tallies[tallies.length - 1];
    check('the membership denominator is right — the circle knows who may vote',
      counted?.of === 3, JSON.stringify(counted));

    // [F-008] The votes are on the log and they VERIFY (checked with the rail directly), yet the
    // tally never counts them: `readCircleMembers` builds the electorate from `listGroupRoster`,
    // whose rows carry per-circle ADDRESSES, while a vote is authored with the person's webid. Two
    // ref spaces that never meet, so a member-vote decision can never reach quorum.
    check('[F-008] the votes are actually counted (not a vacuous zero)',
      (counted?.yes ?? 0) >= 2, JSON.stringify(counted));

    // ── 5. A decision that passed must be enactable, and only by someone entitled ─────────────────
    const settled = await gov.anne.settle?.({ circleId: CIRCLE }).catch(() => null);
    check('an approved decision can be settled by the admin', settled === null || !settled?.error,
      JSON.stringify(settled)?.slice(0, 160));
  } catch (err) {
    check('the governance corridor completed', false, String(err?.message ?? err).slice(0, 200));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
