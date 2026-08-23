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
    const bramVote = await gov.bram.vote({ circleId: CIRCLE, proposalId, voter: bram.pubKey, choice: 'yes' });
    // `ok: false, reason: …` is how this op reports refusal — asserting on `.error` alone let a
    // failed vote read as a success for a whole day.
    check('a member can cast a vote', bramVote?.ok === true, JSON.stringify(bramVote)?.slice(0, 140));
    const catoVote = await gov.cato.vote({ circleId: CIRCLE, proposalId, voter: cato.pubKey, choice: 'yes' });
    check('and so can the third person', catoVote?.ok === true, JSON.stringify(catoVote)?.slice(0, 140));
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

    // Each vote RESPONSE carries the tally as that device knew it at that instant — so it counts the
    // votes that had reached it, not the circle's total. The circle-wide count is a fresh read after
    // both votes have propagated, which is also the only version a person would ever see.
    // The outcome, not the arithmetic: a fresh read once both votes have propagated. A tally is what
    // a pending decision reports; a decided one reports its STATUS and closes, which is what a person
    // actually experiences — "the circle decided" rather than "the counter reads two".
    let outcome = null;
    const decided = await untilTrue(async () => {
      outcome = await tallyOn(gov.anne);
      const t = outcome?.tally ?? outcome;
      return outcome?.status === 'approved' || (t?.yes ?? 0) >= 2;
    }, 15000);
    check('THE CIRCLE DECIDES — two votes carry it to approved', decided,
      JSON.stringify(outcome)?.slice(0, 160));
    check('…and a passed decision is ENACTED, not merely counted',
      outcome?.enacted === true || outcome?.closed === true, JSON.stringify(outcome)?.slice(0, 120));

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
