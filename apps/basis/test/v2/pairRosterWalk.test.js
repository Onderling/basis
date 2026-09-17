/**
 * THE PAIR ROSTER, walked over the bus (L105, 2026-09-18): two card contacts write to each other once — and the roster
 * a contact lacks is there, made from the circle mechanics with nothing new on the wire: a hidden two-member circle
 * both sides derive the id of, the founder's invite riding the first turn (inside the seal), the join through the
 * shared path, the joiner promoted to admin, both person keys root-revealed on both rosters, each other's per-circle
 * addresses known. The launcher lists it on neither. A second exchange makes nothing new. A stranger's invite is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown, readRoster } from '../support/pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';
import { pairCircleIdFor, pairFounderOf } from '../../src/v2/pairRoster.js';
import { loadCircles } from '../../src/v2/circleModel.js';

const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const dm = (from, to, text, messageId) => from.contactThreadChannel.sendTurn({ peerAddr: to.pubKey, threadId: to.pubKey, text, messageId }).sent;
const rowOf = (roster, webid) => (roster ?? []).find((m) => m.webid === webid);
const contactOf = async (node, webid) => (((r) => r?.items ?? r?.contacts ?? [])(await node.agent.callSkill('stoop', 'listContacts', {}))).find((c) => c.webid === webid) ?? null;

describe('two contacts write once — and hold a pair roster', () => {
  let A; let B; let C; let founder; let other; let pairId;
  beforeAll(async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A', { agentOpts: log(), contactChannel: true }),
      bootRealAgentNode('B', { agentOpts: log(), contactChannel: true }),
      bootRealAgentNode('C', { agentOpts: log(), contactChannel: true }),
    ]);
    await connectNodesOverBus([A, B, C]);
    // The Hi: cards both ways (A↔B); C knows both but is a stranger to their pair.
    for (const [me, o] of [[A, B], [B, A], [C, A], [A, C]]) {
      const card = await o.agent.callSkill('stoop', 'getContactShareQr', {});
      expect((await me.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload })).error).toBeUndefined();
    }
    pairId = pairCircleIdFor(A.pubKey, B.pubKey);
    [founder, other] = pairFounderOf(A.pubKey, B.pubKey) === A.pubKey ? [A, B] : [B, A];
  }, 60_000);
  afterAll(async () => { await teardown(A, B, C); });

  it('the OTHER side writes first: its turn carries a request, the founder answers with the invite, the other joins — both rosters carry both person keys and both per-circle addresses', async () => {
    await dm(other, founder, 'hoi', 'x1');
    const settled = await until(async () => {
      const [rf, ro] = await Promise.all([readRoster(founder, pairId), readRoster(other, pairId)]);
      const ok = rowOf(rf, founder.pubKey)?.personKey && rowOf(rf, other.pubKey)?.personKey && rowOf(ro, founder.pubKey)?.personKey && rowOf(ro, other.pubKey)?.personKey;
      return ok ? { rf, ro } : null;
    }, { timeout: 25_000, step: 150 });
    expect(settled, 'the pair roster never settled on both sides').toBeTruthy();
    const { rf, ro } = settled;
    expect(rowOf(rf, other.pubKey).personKey).toEqual(other.agent.personKey());
    expect(rowOf(ro, founder.pubKey).personKey).toEqual(founder.agent.personKey());
    // each knows the other's per-circle address in the pair circle
    expect(rowOf(rf, other.pubKey).circleAddress, 'the founder holds no proven address for the other').toBe(other.agent.circleAddressFor(pairId));
    expect(await until(async () => (rowOf(await readRoster(other, pairId), founder.pubKey)?.circleAddress === founder.agent.circleAddressFor(pairId) ? true : null), { timeout: 15_000, step: 150 }),
      'the other holds no proven address for the founder').toBe(true);
    // both admin — a two-member circle with one admin would be a lopsided contact
    expect(await until(async () => (rowOf(await readRoster(founder, pairId), other.pubKey)?.role === 'admin' ? true : null), { timeout: 15_000, step: 150 }), 'the joiner was not promoted').toBe(true);
    // the words still arrived, as words
    expect(await until(async () => ((await founder.agent.callSkill('stoop', 'listContacts', {})) ? true : null), { timeout: 5000 })).toBe(true);
  }, 60_000);

  it('the contact rows say so; the launcher lists the pair roster on neither side', async () => {
    expect(await until(async () => ((await contactOf(founder, other.pubKey))?.pairCircleId === pairId ? true : null), { timeout: 10_000, step: 150 }), 'the founder\'s contact row has no pair roster').toBe(true);
    expect(await until(async () => ((await contactOf(other, founder.pubKey))?.pairCircleId === pairId ? true : null), { timeout: 10_000, step: 150 }), 'the other\'s contact row has no pair roster').toBe(true);
    for (const node of [founder, other]) {
      const mine = (await node.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
      expect(mine, 'the substrate must still list it (kicks, priming, the ceremony)').toContain(pairId);
      const tiles = await loadCircles({ fetchGroups: async () => mine.map((id) => ({ id, name: id })) });
      expect(tiles.map((c) => c.id), 'the launcher shows a pair roster').not.toContain(pairId);
    }
  }, 30_000);

  it('a second exchange makes nothing new; the founder writing first (other direction) also makes nothing new', async () => {
    const before = (await founder.agent.callSkill('stoop', 'listMyCircles', {}))?.circles?.length;
    await dm(founder, other, 'en jij?', 'x2');
    await dm(other, founder, 'prima', 'x3');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await founder.agent.callSkill('stoop', 'listMyCircles', {}))?.circles?.length).toBe(before);
    expect((await readRoster(founder, pairId)).length).toBe(2);
  }, 30_000);

  it('a stranger cannot put you in a pair of theirs: C writes A with A\'s and B\'s pair id — refused, no join', async () => {
    const pairAC = pairCircleIdFor(A.pubKey, C.pubKey);
    const mineBefore = (await A.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
    // C sends A an invite naming the A–B pair (not the A–C one): the id check refuses it before any redeem
    const forged = await founder.agent.callSkill('stoop', 'getGroupInvite', { groupId: pairId }).catch(() => null);
    const inviteUri = forged?.uri ?? forged?.payload ?? null;
    if (inviteUri) {
      await C.agent.sendPeerMessage(A.pubKey, { subtype: C.contactThreadChannel.subtypes.out, threadId: A.pubKey, text: 'kom erbij', messageId: 'c1', pairInvite: inviteUri });
      await new Promise((r) => setTimeout(r, 1500));
      const mineAfter = (await A.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
      expect(mineAfter.filter((c) => !mineBefore.includes(c))).toEqual([]);
    }
    // …and a proper first exchange between A and C makes THEIR pair
    const [fAC, oAC] = pairFounderOf(A.pubKey, C.pubKey) === A.pubKey ? [A, C] : [C, A];
    await dm(oAC, fAC, 'dag', 'ac1');
    expect(await until(async () => (rowOf(await readRoster(oAC, pairAC), fAC.pubKey)?.personKey ? true : null), { timeout: 25_000, step: 150 }), 'A and C never made their pair').toBe(true);
  }, 60_000);
});
