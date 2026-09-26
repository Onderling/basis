/**
 * The circle POLICY rides the governance lane — a member who joins AFTER the founder stated it catches it up, over the
 * real harness (the regression tripwire for L142; the browser walk `walk-policy-reaches-joiner` proves the shell).
 *
 *   A founds a circle and states its policy (sealed, p2) — the signed `policy-update` statement on A's own lane.
 *   B joins afterwards. A's governance catch-up serves B, and B takes the batch through its PRODUCTION gate: the rail
 *   ingest (signature, declared kind, roster binding), then the apply (receiver-verified admin authority) → B's policy
 *   store says p2.
 *   C joins after the lane's audit window has aged every entry out: A serves from an EMPTY lane, and the only thing
 *   left is the preserved head (the original statement) → C converges too, and can serve it onward.
 *
 * Sibling of `rulesUpdatePropagation.test.js` (the same lane, the rules document).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { makeCirclePolicyLane, makePolicyHeadStore } from '../../src/v2/policyUpdateLane.js';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'policy-propagation-circle';

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}
/** A device's own policy lane over in-memory stores — what a shell builds, minus the storage it happens to use. */
function laneFor(node) {
  const mem = new Map();
  const io = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); } };
  const policies = createCirclePolicyStore({ load: async (id) => (mem.has(`p:${id}`) ? JSON.parse(mem.get(`p:${id}`)) : null), save: async (id, p) => { mem.set(`p:${id}`, JSON.stringify(p)); } });
  const call = (app, op, args) => node.agent.callSkill(app, op, args);
  const lane = makeCirclePolicyLane({
    emitter: () => node.agent.emitPolicyUpdate ?? null,
    headStore: makePolicyHeadStore(io),
    readPolicy: (cid) => policies.get(cid),
    writePolicy: (cid, p) => policies.update(cid, p),
    adminsOf: async (cid) => new Set(((await call('stoop', 'listGroupMembers', { groupId: cid }))?.members ?? [])
      .filter((m) => m?.role === 'admin').map((m) => m.webid).filter(Boolean)),
  });
  return { lane, policies, call };
}
async function joinAfter(A, N, handle) {
  wireMembershipReceiver(N);
  const ok = await joinExistingCircle(A, N, { groupId: CIRCLE, handle });
  expect(ok.joined?.ok, JSON.stringify(ok.joined)).toBe(true);
  await bindCircleAddresses([A, N], CIRCLE);
  await Promise.all([A, N].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
  for (const stmt of A.agent.membershipRail.storedStatements(CIRCLE)) await N.agent.membershipRail.ingest(CIRCLE, stmt);
}
/** N takes a served batch through its production gate: its own governance rail, then the policy apply. */
async function receive(N, laneN, batch) {
  const rail = makeGovernanceRail({ eventLog: N.chatEventLog, circleIdentityFor: N.agent.circleIdentityFor, myRef: '', callSkill: laneN.call });
  const cu = makeGovernanceCatchUp({ rail, sendToPeer: () => {}, onChange: (cid) => laneN.lane.apply(cid, rail).catch(() => {}) });
  await cu.onBatch('addr:A', batch);
}

describe('the circle policy on the governance lane — a later joiner catches it up', () => {
  let A; let B; let C; let bus; let laneA;
  afterAll(async () => { await teardown(A, B, C); });

  it('the founder states it; a member who joins after takes it from the catch-up and holds p2', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A', { taskLane: true }), bootRealAgentNode('B', { taskLane: true })]);
    bus = await connectNodesOverBus([A, B]);
    wireMembershipReceiver(A);
    await createCircle(A, { groupId: CIRCLE, name: 'Verzegeld' });

    laneA = laneFor(A);
    await laneA.policies.update(CIRCLE, { storagePosture: 'p2' });      // the founder's first write…
    const stated = await laneA.lane.state(CIRCLE);                       // …on the lane
    expect(stated?.body?.kind, 'the founder stated the policy').toBe('policy-update');

    await joinAfter(A, B, 'bee');
    const laneB = laneFor(B);
    expect((await laneB.policies.get(CIRCLE)).storagePosture, 'B starts at the default').toBe('p0');

    let served = null;
    const railA = makeGovernanceRail({ eventLog: A.deviceLog, circleIdentityFor: A.agent.circleIdentityFor, myRef: A.pubKey, callSkill: laneA.call });
    const cuA = makeGovernanceCatchUp({ rail: railA, sendToPeer: (addr, payload) => { served = payload; }, extraStatementsFor: (cid) => laneA.lane.preserved(cid) });
    await cuA.onRequest('addr:B', { subtype: cuA.subtypes.request, circleId: CIRCLE });
    expect(served?.statements?.some((s) => s.body.kind === 'policy-update'), 'A serves the policy statement').toBe(true);

    await receive(B, laneB, served);
    const got = await until(async () => ((await laneB.policies.get(CIRCLE)).storagePosture === 'p2' ? true : null), { timeout: 15_000, step: 100 });
    expect(got, 'B never took the founder\'s policy').toBe(true);
  }, 120_000);

  it('after the audit window: from the preserved head alone, a new member still converges — and serves it onward', async () => {
    C = await bootRealAgentNode('C', { taskLane: true });
    const tx = new InternalTransport(bus, C.pubKey);
    await C.agent.sa.addSecureTransport('relay', tx);
    C._busTransport = tx;
    await joinAfter(A, C, 'cee');
    const laneC = laneFor(C);

    let served = null;
    const emptyRail = makeGovernanceRail({ eventLog: new EventLog({ initial: [] }), circleIdentityFor: A.agent.circleIdentityFor, myRef: A.pubKey, callSkill: laneA.call });
    const cuA = makeGovernanceCatchUp({ rail: emptyRail, sendToPeer: (addr, payload) => { served = payload; }, extraStatementsFor: (cid) => laneA.lane.preserved(cid) });
    await cuA.onRequest('addr:C', { subtype: cuA.subtypes.request, circleId: CIRCLE });
    expect(served?.statements?.map((s) => s.body.kind), 'only the preserved head is left').toEqual(['policy-update']);

    await receive(C, laneC, served);
    const got = await until(async () => ((await laneC.policies.get(CIRCLE)).storagePosture === 'p2' ? true : null), { timeout: 15_000, step: 100 });
    expect(got, 'C never converged from the preserved head').toBe(true);
    expect((await laneC.lane.preserved(CIRCLE))[0]?.body?.hash, 'C keeps the original statement to serve onward')
      .toBe((await laneA.lane.preserved(CIRCLE))[0]?.body?.hash);
  }, 120_000);
});
