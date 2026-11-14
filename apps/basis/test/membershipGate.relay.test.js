/**
 * THE MEMBERSHIP GATE, OVER THE RELAY: three real agents on a real relay, each judging what reaches it.
 *   - Admins decide removals together: one admin's lone removal does not take effect on another member's device; the
 *     same removal, proposed and voted yes by both admins, enacted with its proposal, does.
 *   - Admins decide settings together (a role change follows the settings rule): one admin's lone promotion does not
 *     take effect on another member's device; proposed and voted yes by both admins, it does.
 * The bus walk (v2/membershipGate.walk.test.js) proves the lone case with the bus harness; this one crosses the relay
 * and walks the vote, with the governance binding the shells compose (bindCircleGovernance + the broadcast).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { removeCircleMember } from '../src/v2/circleMembershipHygiene.js';
import { normalizeCirclePolicy } from '../src/v2/circlePolicy.js';
import { bindCircleGovernance, makeGovernanceBroadcast } from '../src/v2/governanceAppWiring.js';
import { EventLog } from '../src/eventLog.js';

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}
const roster = async (node, circleId) => ((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: circleId }))?.members ?? []);
const inRoster = async (node, circleId, webid) => (await roster(node, circleId)).some((m) => m?.webid === webid);
const roleOn = async (node, circleId, webid) => (await roster(node, circleId)).find((m) => m?.webid === webid)?.role ?? null;
const settle = (ms = 4000) => new Promise((res) => { setTimeout(res, ms); });
const soon = (fn, timeout = 20_000) => until(async () => ((await fn()) ? true : null), { timeout, step: 300 }).catch(() => false);

describe('the membership gate, over the relay', () => {
  let relay; let founder; let bram; let cato;
  const logs = new Map();
  const policies = new Map();   // the settings each circle was given here, by version (what a shell's policy store holds)
  const govOf = (node) => bindCircleGovernance({
    eventLog: logs.get(node), callSkill: (...a) => node.agent.callSkill(...a),
    getPolicy: async (cid) => policies.get(cid)?.policy ?? {}, myRef: () => node.pubKey,
    genId: () => `gov-${Math.random().toString(36).slice(2, 10)}`, broadcast: makeGovernanceBroadcast((...a) => node.agent.callSkill(...a)),
    circleIdentityFor: node.agent.circleIdentityFor, spineGate: node.agent.spineGate ?? null, agent: node.agent,
    policyVersionOf: async (cid) => policies.get(cid)?.version ?? null,
  });
  const state = async (circleId, policy, version) => {
    policies.set(circleId, { policy, version });
    const st = await founder.agent.emitPolicyUpdate({ groupId: circleId, policy, version });
    expect(st?.body?.hash, `settings version ${version} stated`).toBeTruthy();
  };

  async function circleOf3(circleId, governance) {
    await createCircle(founder, { groupId: circleId, name: circleId });
    for (const [who, handle] of [[bram, 'bram'], [cato, 'cato']]) {
      expect((await joinExistingCircle(founder, who, { groupId: circleId, handle })).joined?.ok).toBe(true);
    }
    await bindCircleAddresses([founder, bram, cato], circleId);
    await Promise.all([founder, bram, cato].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));
    await state(circleId, normalizeCirclePolicy({ governance }), 1);
    // a second admin while any admin decides settings (role changes follow the settings rule): this one stands
    const promoted = await founder.agent.callSkill('pinboard', 'setMemberRole', { groupId: circleId, memberWebid: bram.pubKey, role: 'admin' });
    expect(promoted?.ok, JSON.stringify(promoted)).toBe(true);
    expect(await soon(async () => (await roleOn(bram, circleId, bram.pubKey)) === 'admin'), 'bram is an admin on his own device').toBe(true);
  }

  /** Founder proposes, bram votes yes (the second yes carries it; an admin's device enacts it with its proposal). */
  async function voted(circleId, action, subject) {
    const gF = govOf(founder); const gB = govOf(bram);
    const p = await gF.propose({ circleId, action, subject, actor: { ref: founder.pubKey } });
    expect(p?.proposalId, `proposed: ${JSON.stringify(p)}`).toBeTruthy();
    expect(p.enacted ?? false, 'one admin alone does not carry it').toBe(false);
    expect(await soon(async () => ((await gB.view(circleId))?.open ?? []).some((x) => x.proposalId === p.proposalId)), 'the proposal reached bram').toBe(true);
    const v = await gB.vote({ circleId, proposalId: p.proposalId, voter: bram.pubKey, choice: 'yes' });
    expect(v?.ok, JSON.stringify(v)).toBe(true);
    // whichever admin device enacts (the voter's, when its yes completes the count), the decision is approved and closed
    let t = null;
    expect(await soon(async () => { t = await gF.tally({ circleId, proposalId: p.proposalId }); return t?.status === 'approved' && (t.enacted === true || t.closed === true); }), `approved and enacted: vote ${JSON.stringify(v)}, tally ${JSON.stringify(t)}`).toBe(true);
    return { proposalId: p.proposalId, vote: v };
  }

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = (name) => {
      const log = new EventLog({ initial: [], muted: [] });
      return { log, o: { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log } }, name };
    };
    const made = ['founder', 'bram', 'cato'].map(opts);
    [founder, bram, cato] = await Promise.all(made.map(({ name, o }) => bootRealAgentNode(name, o)));
    [founder, bram, cato].forEach((n, i) => logs.set(n, made[i].log));
    await connectNodesOverRelay([founder, bram, cato], { relayUrl: relay.url });
    for (const n of [founder, bram, cato]) wireMembershipReceiver(n);
  }, 180_000);
  afterAll(async () => { try { await teardown(founder, bram, cato); } catch { /* */ } await relay?.close?.(); });

  it('admins decide removals together: a lone removal holds on bram\'s device; with both admins\' yes it takes effect', async () => {
    const C = 'gate-relay-removal';
    await circleOf3(C, { removeMember: 'admin-quorum', changePolicy: 'any-admin' });
    const lone = await removeCircleMember({ agent: founder.agent, callSkill: (...a) => founder.agent.callSkill(...a), circleId: C, memberWebid: cato.pubKey });
    expect(lone.ok, JSON.stringify(lone)).toBe(true);   // the op ran: the statement went out over the relay
    await settle();
    expect(await inRoster(bram, C, cato.pubKey), 'bram\'s device keeps cato: the removal skipped the vote').toBe(true);

    await voted(C, 'removeMember', cato.pubKey);
    expect(await soon(async () => !(await inRoster(bram, C, cato.pubKey))), 'bram\'s device removes cato once both admins said yes').toBe(true);
    expect(await soon(async () => !(await inRoster(founder, C, cato.pubKey))), 'the founder\'s device too').toBe(true);
  }, 180_000);

  it('admins decide settings together: a lone promotion holds on bram\'s device; with both admins\' yes it takes effect', async () => {
    const C = 'gate-relay-role';
    await circleOf3(C, { removeMember: 'any-admin', changePolicy: 'any-admin' });
    await state(C, normalizeCirclePolicy({ governance: { removeMember: 'any-admin', changePolicy: 'admin-quorum' } }), 2);
    await settle(2000);
    const lone = await founder.agent.callSkill('pinboard', 'setMemberRole', { groupId: C, memberWebid: cato.pubKey, role: 'admin' });
    expect(lone?.ok, JSON.stringify(lone)).toBe(true);
    await settle();
    expect(await roleOn(bram, C, cato.pubKey), 'bram\'s device keeps cato a member: the promotion skipped the vote').toBe('member');

    await voted(C, 'changeRole', { member: cato.pubKey, role: 'admin' });
    expect(await soon(async () => (await roleOn(bram, C, cato.pubKey)) === 'admin'), 'bram\'s device makes cato an admin once both admins said yes').toBe(true);
    expect(await soon(async () => (await roleOn(founder, C, cato.pubKey)) === 'admin'), 'the founder\'s device too').toBe(true);
  }, 180_000);
});
