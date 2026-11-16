/**
 * "N MEMBERS JOINED SINCE THIS PROPOSAL WAS MADE", CROSSED FOR REAL: three real agents on a real relay. The founder and
 * bram are members; the founder proposes a rules change the members decide (2 members: it waits for bram); THEN cato
 * joins through the real redeem. The founder's Decisions view, through the governance binding the shells compose (with
 * the agent, so it reads the circle's membership statements from the real membership rail), says 1 joined since: cato,
 * not bram (who joined before the proposal).
 *
 * The two things that would make the line silently never appear are asserted on their own, each naming its branch:
 * (1) the REAL join, read back from the membership rail's verified bodies, still carries its signed time `payload.at`;
 * (2) its `subject` is the same ref the governance roster uses for that member.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { normalizeCirclePolicy } from '../src/v2/circlePolicy.js';
import { bindCircleGovernance, makeGovernanceBroadcast } from '../src/v2/governanceAppWiring.js';
import { EventLog } from '../src/eventLog.js';

const soon = (fn, timeout = 20_000) => until(async () => ((await fn()) ? true : null), { timeout, step: 300 }).catch(() => false);

describe('the joined-since line, over the relay, from real joins', () => {
  let relay; let founder; let bram; let cato;
  const logs = new Map();
  const policies = new Map();

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const made = ['founder', 'bram', 'cato'].map((name) => {
      const log = new EventLog({ initial: [], muted: [] });
      return { log, name, o: { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log } } };
    });
    [founder, bram, cato] = await Promise.all(made.map(({ name, o }) => bootRealAgentNode(name, o)));
    [founder, bram, cato].forEach((n, i) => logs.set(n, made[i].log));
    await connectNodesOverRelay([founder, bram, cato], { relayUrl: relay.url });
  }, 180_000);
  afterAll(async () => { try { await teardown(founder, bram, cato); } catch { /* */ } await relay?.close?.(); });

  it('a member who joins after the proposal is counted on the founder\'s Decisions view; one who joined before is not', async () => {
    const C = 'joined-since-relay';
    await createCircle(founder, { groupId: C, name: C });
    expect((await joinExistingCircle(founder, bram, { groupId: C, handle: 'bram' })).joined?.ok, 'bram joins before the proposal').toBe(true);
    await bindCircleAddresses([founder, bram], C);
    await Promise.all([founder, bram].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: C })));
    const policy = normalizeCirclePolicy({ governance: { changeRule: 'member-vote' } });
    policies.set(C, { policy, version: 1 });
    expect((await founder.agent.emitPolicyUpdate({ groupId: C, policy, version: 1 }))?.body?.hash, 'settings stated').toBeTruthy();

    // the governance binding as the shells compose it, WITH the agent (that is what hands the host the membership rail)
    const gov = bindCircleGovernance({
      eventLog: logs.get(founder), callSkill: (...a) => founder.agent.callSkill(...a),
      getPolicy: async (cid) => policies.get(cid)?.policy ?? {}, myRef: () => founder.pubKey,
      genId: () => `gov-${Math.random().toString(36).slice(2, 10)}`, broadcast: makeGovernanceBroadcast((...a) => founder.agent.callSkill(...a)),
      circleIdentityFor: founder.agent.circleIdentityFor, spineGate: founder.agent.spineGate ?? null, agent: founder.agent,
      policyVersionOf: async (cid) => policies.get(cid)?.version ?? null,
    });
    const p = await gov.propose({ circleId: C, action: 'changeRule', subject: { name: 'Huisregels' }, actor: { ref: founder.pubKey } });
    expect(p?.proposalId, `proposed: ${JSON.stringify(p)}`).toBeTruthy();
    expect(p.status, 'two members decide: it waits for bram').toBe('pending');

    // cato joins AFTER the proposal, through the real redeem
    await new Promise((r) => { setTimeout(r, 20); });   // a join in the same millisecond as the proposal is not 'after'
    expect((await joinExistingCircle(founder, cato, { groupId: C, handle: 'cato' })).joined?.ok, 'cato joins after the proposal').toBe(true);

    // (1) the real join comes back from the membership rail with its signed time
    let catoJoin = null;
    expect(await soon(async () => {
      const bodies = await founder.agent.membershipBodies(C);
      catoJoin = (bodies ?? []).filter((b) => b?.kind === 'join').find((b) => b.subject === cato.pubKey) ?? null;
      return !!catoJoin;
    }), 'branch (1a): the founder\'s membership rail holds a join whose subject is cato\'s roster ref').toBe(true);
    expect(typeof catoJoin.payload?.at, `branch (1b): the real join keeps its signed time (payload keys: ${Object.keys(catoJoin.payload ?? {}).join(', ')})`).toBe('number');

    // (2) the subject is the ref the governance roster uses
    const ctx = await gov.getContext(C);
    expect(ctx.members.some((m) => m.ref === catoJoin.subject), `branch (2): the governance roster names cato by the join's subject (roster refs: ${ctx.members.map((m) => String(m.ref).slice(0, 8)).join(', ')})`).toBe(true);

    // the line itself: 1 joined since (cato), bram is not counted
    let row = null;
    expect(await soon(async () => {
      const view = await gov.view(C);
      row = (view.open ?? []).find((r) => r.proposalId === p.proposalId) ?? null;
      return row?.joinedSince === 1;
    }), `the founder's view says 1 joined since (row: ${JSON.stringify(row && { joinedSince: row.joinedSince, status: row.status })})`).toBe(true);
  }, 180_000);
});
