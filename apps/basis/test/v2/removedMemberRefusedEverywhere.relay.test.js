/**
 * A REMOVED MEMBER IS REFUSED BY EVERY MEMBER'S DEVICE, NOT ONLY BY THE ADMIN'S.
 *
 * The admin's device re-records its authorize snapshot when it removes someone (`removeCircleMember`). Another
 * member's device only folds the removal when it lands. The question this walk answers: does that other device then
 * refuse what the removed member still sends? A removed member who keeps talking is not using a well-behaved app, so
 * the send here goes straight to the wire (the removed member's own app signs it, then sends it past its own gate).
 *
 * Three devices over a real relay with the real factory: admin, bram and cato in one circle. Control: cato's line
 * reaches bram while cato is a member. Then the admin removes cato; bram's roster no longer names cato; cato signs
 * a line and sends it straight to bram's circle address. Acceptance: bram never shows it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { removeCircleMember } from '../../src/v2/circleMembershipHygiene.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'circle-removed-member-refused';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const textsIn = (node) => node.chatRail.storedStatements(CIRCLE).map((s) => s?.body?.payload?.text).filter(Boolean);

/** cato's own app signs a line and fans it to the circle the way the product does (`sendCircleChat`: the chat rail's
 *  signed statement through the circle broadcast). After the removal, cato's device still knows the other members'
 *  addresses: what a client that ignores its own removal would send. */
async function sendStraight(from, _to, text, msgId) {
  const r = await sendCircleChat(from, { groupId: CIRCLE, msgId, text });
  if (r?.error) throw new Error(`cato could not send: ${r.error}`);
  return r;
}

describe('a removed member is refused by every member\'s device', () => {
  let relay; let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    [admin, bram, cato] = await Promise.all(['admin', 'bram', 'cato'].map((n) => bootRealAgentNode(n, opts())));
    await connectNodesOverRelay([admin, bram, cato], { relayUrl: relay.url });
    await createCircle(admin, { groupId: CIRCLE, name: 'R' });
    await settleMember(admin, CIRCLE);
    for (const [who, handle] of [[bram, 'bram'], [cato, 'cato']]) {
      expect((await joinExistingCircle(admin, who, { groupId: CIRCLE, handle })).joined.ok).toBe(true);
      await settleMember(who, CIRCLE);
    }
    await Promise.all([admin, bram, cato].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const n of [admin, bram, cato]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE });
  }, 240_000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* */ }
    try { await relay?.stop?.(); } catch { /* */ }
  });

  it('control: while cato is a member, cato\'s line reaches bram', async () => {
    await sendStraight(cato, bram, 'nog lid', 'cato-before');
    expect(await until(async () => (textsIn(bram).includes('nog lid') ? true : null), { timeout: 20_000, step: 300 })).toBe(true);
  }, 60_000);

  it('after the admin removes cato, bram refuses what cato still sends', async () => {
    const r = await removeCircleMember({ agent: admin.agent, callSkill: (...a) => admin.agent.callSkill(...a), circleId: CIRCLE, memberWebid: cato.pubKey });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await until(async () => ((await readRoster(bram, CIRCLE)).some((m) => m?.webid === cato.pubKey) ? null : true), { timeout: 20_000, step: 300 }), 'bram\'s roster no longer names cato').toBe(true);
    // record what cato's device actually puts on the wire to bram after its removal (the branch this test takes)
    const toBram = [];
    const peer = cato.agent.peer; const orig = peer.sendTo.bind(peer);
    const bramAddr = bram.agent.circleAddressFor(CIRCLE);
    peer.sendTo = (to, env, o) => { if (to === bramAddr) toBram.push(env?.subtype ?? env?.type ?? null); return orig(to, env, o); };
    let sendErr = null;
    try { await sendStraight(cato, bram, 'na verwijdering', 'cato-after'); } catch (e) { sendErr = e?.message ?? String(e); }
    finally { peer.sendTo = orig; }
    await settle(5000);
    // the branch: cato's device DID put the line on the wire to bram (else bram had nothing to refuse)
    expect(sendErr).toBeNull();
    expect(toBram, 'cato\'s device sent the line to bram after its removal').toContain('circle-chat-statement');
    expect(textsIn(bram), 'bram never shows a line from a removed member').not.toContain('na verwijdering');
  }, 90_000);
});
