/**
 * THE MEMBERSHIP GATE, WALKED: in a circle whose admins decide removals TOGETHER, one admin's lone removal does not
 * take effect on any member's device; in a circle where ANY admin decides, the same lone removal does (the control:
 * the gate holds back only what the rule asks a vote for).
 *
 * Three real agents over the bus harness with their device logs (the governance lane lands there, which is where the
 * host builds the gate from): the founder states the circle's settings (version 1, the founding write), promotes a
 * second admin where the rule needs two, then removes the third person alone, straight through the op (no proposal,
 * no vote): what a modified app, or a skipped door, sends.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { removeCircleMember } from '../../src/v2/circleMembershipHygiene.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { EventLog } from '../../src/eventLog.js';

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}
const roster = async (node, circleId) => ((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: circleId }))?.members ?? []);
const names = async (node, circleId, webid) => (await roster(node, circleId)).some((m) => m?.webid === webid);
const adminOn = async (node, circleId, webid) => (await roster(node, circleId)).some((m) => m?.webid === webid && m.role === 'admin');

async function circleOf3({ founder, second, third }, circleId, removeMember) {
  await createCircle(founder, { groupId: circleId, name: circleId });
  for (const [who, handle] of [[second, 'bram'], [third, 'cato']]) {
    expect((await joinExistingCircle(founder, who, { groupId: circleId, handle })).joined?.ok).toBe(true);
  }
  await bindCircleAddresses([founder, second, third], circleId);
  await Promise.all([founder, second, third].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));
  // the founding settings (version 1, the founder's): who decides a removal
  const policy = normalizeCirclePolicy({ governance: { removeMember, changePolicy: 'any-admin' } });
  const st = await founder.agent.emitPolicyUpdate({ groupId: circleId, policy, version: 1 });
  expect(st?.body?.hash, 'the founding settings were stated').toBeTruthy();
}

describe('the membership gate, walked', () => {
  let founder; let second; let third;
  afterAll(async () => { try { await teardown(founder, second, third); } catch { /* */ } });

  it('admins decide together: one admin\'s lone removal does not take effect anywhere; any admin decides: it does', async () => {
    const opts = () => ({ agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    [founder, second, third] = await Promise.all(['founder', 'bram', 'cato'].map((n) => bootRealAgentNode(n, opts())));
    await connectNodesOverBus([founder, second, third]);
    for (const n of [founder, second, third]) wireMembershipReceiver(n);

    // ── the circle whose admins decide removals together ──
    const TOGETHER = 'gate-walk-together';
    await circleOf3({ founder, second, third }, TOGETHER, 'admin-quorum');
    // a second admin (role changes follow the settings class: any admin here, so this stands)
    const promoted = await founder.agent.callSkill('pinboard', 'setMemberRole', { groupId: TOGETHER, memberWebid: second.pubKey, role: 'admin' });
    expect(promoted?.ok, JSON.stringify(promoted)).toBe(true);
    expect(await until(async () => ((await adminOn(second, TOGETHER, second.pubKey)) ? true : null), { timeout: 20_000, step: 300 }), 'bram is an admin on his own device').toBe(true);
    // the lone removal, straight through the op (no proposal, no vote)
    const r = await removeCircleMember({ agent: founder.agent, callSkill: (...a) => founder.agent.callSkill(...a), circleId: TOGETHER, memberWebid: third.pubKey });
    expect(r.ok, JSON.stringify(r)).toBe(true);   // the op ran (its own admin gate passed): the statement went out
    await new Promise((res) => { setTimeout(res, 4000); });
    expect(await names(second, TOGETHER, third.pubKey), 'bram\'s device keeps cato: the removal skipped the vote').toBe(true);
    expect(await names(founder, TOGETHER, third.pubKey), 'the founder\'s own device folds the same: cato stays').toBe(true);

    // ── the control: any admin decides removals ──
    const ANY = 'gate-walk-any-admin';
    await circleOf3({ founder, second, third }, ANY, 'any-admin');
    const r2 = await removeCircleMember({ agent: founder.agent, callSkill: (...a) => founder.agent.callSkill(...a), circleId: ANY, memberWebid: third.pubKey });
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    expect(await until(async () => ((await names(second, ANY, third.pubKey)) ? null : true), { timeout: 20_000, step: 300 }), 'bram\'s device removes cato where any admin decides').toBe(true);

    // ── OPUS'S CASE: a removal made under any-admin through the PLAIN op (no stamp passed by the caller) stays valid
    // after the circle tightens to a member vote: the membership emitter stamps every removal by construction ──
    const tighter = normalizeCirclePolicy({ governance: { removeMember: 'member-vote', changePolicy: 'any-admin' } });
    const st2 = await founder.agent.emitPolicyUpdate({ groupId: ANY, policy: tighter, version: 2 });
    expect(st2?.body?.hash, 'the circle tightened (version 2)').toBeTruthy();
    await new Promise((res) => { setTimeout(res, 4000); });
    expect(await names(second, ANY, third.pubKey), 'cato stays removed after the circle moved to a member vote').toBe(false);
    expect(await names(founder, ANY, third.pubKey), 'on the founder\'s device too').toBe(false);
  }, 240_000);
});
