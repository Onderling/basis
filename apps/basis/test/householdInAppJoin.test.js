/**
 * The household in a person's own app, on real agents: the bot's household circle (its own id, `household:<16 hex>`)
 * gets its rules the first time someone is invited — the bot founds it, so the bot is its admin — and the invite is
 * bound to the invitee's chat key: they join with it; someone else holding the same invite does not.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, bindCircleAddresses, teardown } from './support/pairRealAgents.js';
import { joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { createHouseholdInApp } from '../src/v2/householdInApp.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const nodes = [];
afterAll(() => teardown(...nodes));

const join = (node, uri) => joinCircleFromInvite({
  inviteUri: uri, callSkill: (a, o, x) => node.agent.callSkill(a, o, x), sendPeerRedeem: node.sendPeerRedeem,
  handle: 'bob', rulesAccepted: true,
  circleAddressFor: (cid) => node.agent.circleAddressFor?.(cid) ?? null,
  signCircleLink: (s, d, a) => node.agent.signCircleLink?.(s, d, a) ?? null,
});

describe('the household circle and the bound invite', () => {
  it('first invite makes the circle (the bot its admin); Bob joins with his; Eve with Bob\'s does not', async () => {
    const [bot, bob, eve] = await Promise.all([
      bootRealAgentNode('bot', { taskLane: true, agentOpts: { ...HOUSEHOLD_BOT_STORE_OPTS } }),
      bootRealAgentNode('bob', { taskLane: true }), bootRealAgentNode('eve', { taskLane: true }),
    ]);
    nodes.push(bot, bob, eve);
    await connectNodesOverBus([bot, bob, eve]);
    const circleId = bot.agent.householdCircleId;
    expect(circleId).toMatch(/^household:[0-9a-f]{16}$/);
    const inApp = createHouseholdInApp({ callSkill: (a, o, x) => bot.agent.callSkill(a, o, x), circleId, selfWebid: bot.pubKey, name: () => 'Thuis', identityOf: (a) => bot.agent.identityOfAddress?.(a) ?? a,
      // as the box does after founding: the bot present at its address in the new circle
      onCreated: ({ circleId: cid }) => bindCircleAddresses([bot], cid) });

    const circlesOf = async () => (await bot.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
    expect(await circlesOf()).not.toContain(circleId);
    const inv = await inApp.inviteFor(bob.pubKey);
    expect(inv.ok, JSON.stringify(inv)).toBe(true);
    expect(await circlesOf()).toContain(circleId);
    // a second invite does not found it again
    expect((await inApp.ensureCircle()).created).toBe(false);

    const eveTry = await join(eve, inv.uri);
    expect(JSON.stringify(eveTry), 'refused as a wrong code, not for a harness reason').toMatch(/invalid-or-expired-code/);
    const bobJoin = await join(bob, inv.uri);
    expect(bobJoin?.error, JSON.stringify(bobJoin)).toBeFalsy();
    const roster = await bot.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    expect((roster?.members ?? []).map((m) => m.webid)).toContain(bob.pubKey);
    expect((roster?.members ?? []).map((m) => m.webid)).not.toContain(eve.pubKey);

    // `/revoke` evicts: the circle's roster loses every address that is Bob's
    const out = await inApp.evict(bob.pubKey);
    expect(out.removed, JSON.stringify(out)).toBe(1);
    const after = await bot.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    expect((after?.members ?? []).map((m) => m.webid)).not.toContain(bob.pubKey);
    expect((await inApp.evict(bob.pubKey)).removed).toBe(0);   // nobody left to remove
  }, 120_000);
});
