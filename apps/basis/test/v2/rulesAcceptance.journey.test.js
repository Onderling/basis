/**
 * Rules acceptance on the membership statement — the acceptance-on-record and modified-client journeys
 * (plans/JOURNEYS.md, the sitting decision of 2026-08-20), walked through the PRODUCTION join path over the real harness:
 * joinCircleFromInvite → finalSubmit → redeemMembershipCode → the membership rider's signed join →
 * the fan → every receiving device's rail ingest → the AUTHORITATIVE fold.
 *
 * The membership receiver is registered PER-TEST (the three-party-walk rule: riders are an explicit per-test act,
 * never a harness default — the router-default version broke the stolen-device walk's equilibrium).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, until, teardown } from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { joinCircleFromInvite, buildCircleInviteUri } from '../../src/v2/circleInvite.js';

const C = 'rules-gated-circle';
const members = async (n) => (await n.agent.callSkill('stoop', 'listGroupMembers', { groupId: C }))?.members ?? [];
const rowOf = (rows, webid) => rows.find((m) => (m.webid ?? m.addr ?? m.ref) === webid) ?? null;

/** The per-test membership receiver: MEMBERSHIP_BROADCAST envelopes feed the node's own rail ingest. */
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

describe('rules acceptance — J-RA1 + J-RA2 over the production join path', () => {
  let A; let B; let X;
  afterAll(async () => { await teardown(A, B, X); });

  it('the acceptance is on the record everywhere · the acceptance-less join lands nowhere', async () => {
    [A, B, X] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
      bootRealAgentNode('X', { taskLane: true }),
    ]);
    await connectNodesOverBus([A, B, X]);
    for (const n of [A, B, X]) wireMembershipReceiver(n);

    // A creates the circle — createGroupV2 writes a rules doc (version 1) for every circle, so this
    // circle is rules-gated from birth.
    await createCircle(A, { groupId: C, name: 'Rules-gated' });

    // B joins THROUGH THE WIZARD CHAIN with the rules ticked (rulesAccepted: true → 'v'1 on the statement).
    const okJoin = await joinExistingCircle(A, B, { groupId: C, handle: 'bee' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);

    // X joins through the SAME production path but never accepts — the modified client (J-RA2).
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => A.agent.callSkill(app, op, args), circleId: C, adminPeerAddr: A.pubKey,
    });
    const noAccept = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => X.agent.callSkill(app, op, args),
      sendPeerRedeem: X.sendPeerRedeem,
      handle: 'exjoiner',
      // rulesAccepted deliberately NOT passed — the explicit-only contract's default (false).
    });

    await new Promise((r) => setTimeout(r, 800));   // let fans + announces land

    const onA = await members(A);
    const onB = await members(B);
    console.log('DIAG A roster:', onA.map((m) => `${(m.webid ?? '').slice(0, 8)} rules=${m.rulesAccepted ?? '-'}`));
    console.log('DIAG B roster:', onB.map((m) => `${(m.webid ?? '').slice(0, 8)} rules=${m.rulesAccepted ?? '-'}`));

    // Acceptance-on-record — B's acceptance is visible ON A's device, read from the fold's projection.
    const bOnA = rowOf(onA, B.pubKey);
    expect(bOnA, 'B is on A\'s roster').toBeTruthy();
    expect(bOnA.rulesAccepted, 'B\'s accepted version projects to A').toBe('1');

    // The modified client joins NOWHERE. Walking this journey forced a design addition: the
    // fold gate alone was toothless, because the post-join address announce seeds a roster row on
    // every device regardless of the spine. So admission is refused at the ADMITTING device's writer —
    // typed, before any row, key grant, announce or spine entry exists — and the fold gate remains for
    // the spine-propagation path. Two layers, neither under the joiner's control.
    expect(noAccept.error).toBe('rules-acceptance-required');
    expect(rowOf(onA, X.pubKey), 'X must not exist on the admitting device either').toBeNull();
    expect(rowOf(onB, X.pubKey), 'X must not fold on any other device').toBeNull();
  }, 90000);
});

describe('the human-rules field list — one agreement, two homes', () => {
  it('the consent extractor and the admission gate read the SAME seven fields', async () => {
    // basis's extractRulesDoc keeps a local list (adding an @onderling/circles import to the wizard
    // risks the hand-accreted tree's resolution), so the AGREEMENT is pinned instead: whoever changes
    // one list changes both, or decides on purpose that they differ. Same contract as the relay/app
    // hold-time pin.
    const { HUMAN_RULES_FIELDS } = await import('../../../../packages/circles/src/circleRulesDoc.js');
    const { extractRulesDoc } = await import('../../src/core/wizards/joinGroupState.js');
    // A doc with exactly one field set, per field: the extractor must SEE every gate field…
    for (const f of HUMAN_RULES_FIELDS) {
      expect(extractRulesDoc({ [f]: 'x' }), `extractor sees gate field "${f}"`).toBeTruthy();
    }
    // …and see NOTHING in an operational-only doc (the fields the gate also ignores).
    expect(extractRulesDoc({ keyRotationMode: 'off', storage: {}, version: 3 })).toBeNull();
  });
});
