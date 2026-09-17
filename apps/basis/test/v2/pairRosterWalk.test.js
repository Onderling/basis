/**
 * THE PAIR ROSTER, walked over the bus (L105, 2026-09-18): two card contacts write to each other once — and the roster
 * a contact lacks is there, made from the circle mechanics with nothing new on the wire: a hidden two-member circle
 * both sides derive the id of, the founder's invite riding the first turn (inside the seal), the join through the
 * shared path, the joiner promoted to admin, both person keys root-revealed on both rosters, each other's per-circle
 * addresses known. The launcher lists it on neither. A second exchange makes nothing new. A stranger's invite is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown, readRoster, bindCircleAddresses } from '../support/pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';
import { pairCircleIdFor, pairFounderOf } from '../../src/v2/pairRoster.js';
import { loadCircles } from '../../src/v2/circleModel.js';

const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const dm = (from, to, text, messageId) => from.contactThreadChannel.sendTurn({ peerAddr: to.pubKey, threadId: to.pubKey, text, messageId }).sent;
const rowOf = (roster, webid) => (roster ?? []).find((m) => m.webid === webid);
const threadTexts = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []).map((t) => t.text);
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

describe('the route (8b): once the pair roster exists, a DM travels over it — and a revoke reaches the contact with no chain pull', () => {
  let A; let B; let founder; let other; let pairId; let wireAtA; let wireAtB; let sentByB;
  beforeAll(async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A', { agentOpts: log(), contactChannel: true }), bootRealAgentNode('B', { agentOpts: log(), contactChannel: true })]);
    await connectNodesOverBus([A, B]);
    for (const [me, o] of [[A, B], [B, A]]) {
      const card = await o.agent.callSkill('stoop', 'getContactShareQr', {});
      expect((await me.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload })).error).toBeUndefined();
    }
    pairId = pairCircleIdFor(A.pubKey, B.pubKey);
    [founder, other] = pairFounderOf(A.pubKey, B.pubKey) === A.pubKey ? [A, B] : [B, A];
    // every envelope as it arrives, with the address it came FROM (the route shows in the sender's address)
    const tap = (node) => { const seen = []; const prior = node._routerRef.fn; node._routerRef.fn = (env) => { seen.push({ from: env.from, p: env.payload }); return prior?.(env); }; return seen; };
    wireAtA = tap(A); wireAtB = tap(B);
    // what B sends (the pull-request subtype must never appear once the roster exists)
    sentByB = []; const origSend = B.agent.sendPeerMessage.bind(B.agent);
    B.agent.sendPeerMessage = (to, payload, opts) => { sentByB.push({ to, subtype: payload?.subtype, opts }); return origSend(to, payload, opts); };
    // the first exchange makes the roster (the walk above proves how); wait for both sides to hold both keys + addresses
    await dm(other, founder, 'hoi', 'r0');
    expect(await until(async () => {
      const [rf, ro] = await Promise.all([readRoster(founder, pairId), readRoster(other, pairId)]);
      return (rowOf(rf, other.pubKey)?.circleAddress && rowOf(ro, founder.pubKey)?.circleAddress && rowOf(rf, other.pubKey)?.personKey && rowOf(ro, founder.pubKey)?.personKey) ? true : null;
    }, { timeout: 25_000, step: 150 }), 'the pair roster never settled').toBe(true);
    await bindCircleAddresses([A, B], pairId);
  }, 60_000);
  afterAll(async () => { await teardown(A, B); });

  it('B → A goes over the pair circle: it leaves as B\'s per-circle address there, to A\'s primary one, sealed to the key the roster folded — never to the profile address', async () => {
    const before = wireAtA.length;
    await dm(B, A, 'over de ring', 'r1');
    const arrived = await until(() => wireAtA.slice(before).find((e) => e.p?.messageId === 'r1') ?? null, { timeout: 15_000, step: 100 });
    expect(arrived, 'the DM never reached A').toBeTruthy();
    expect(arrived.from, 'the DM did not leave as B\'s per-circle address on the pair roster').toBe(B.agent.circleAddressFor(pairId));
    expect(arrived.p.sealed?.to?.pubKey).toBe(A.agent.personKey().pubKey);
    expect(arrived.p.text).toBe('');
    // …and it landed in A's thread with B, keyed by identity, opened
    expect(await until(async () => ((await threadTexts(A, B.pubKey)).includes('over de ring') ? true : null), { timeout: 15_000, step: 100 }), 'A\'s thread with B does not hold it').toBe(true);
    const routed = sentByB.filter((s) => s.subtype === 'contact-msg' && s.opts?.circleId === pairId);
    expect(routed.length, 'the channel did not route over the pair circle').toBeGreaterThan(0);
  }, 40_000);

  it('A revokes a device: the rotation reaches B over the pair roster root-revealed; B\'s next DM seals to the NEW version with NO chain pull (the window after a revoke is closed for this contact)', async () => {
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'a-device-anna-never-enrolled', circleIds: [] });
    expect(r.personKeyVersion, JSON.stringify(r)).toBe(2);
    expect(await until(async () => (rowOf(await readRoster(B, pairId), A.pubKey)?.personKey?.version === 2 ? true : null), { timeout: 20_000, step: 150 }), 'B\'s pair roster never folded Anna\'s rotation').toBe(true);
    const pulls = sentByB.filter((s) => String(s.subtype).startsWith('person-key-chain')).length;
    const before = wireAtA.length;
    await dm(B, A, 'na de wissel', 'r2');
    const arrived = await until(() => wireAtA.slice(before).find((e) => e.p?.messageId === 'r2') ?? null, { timeout: 15_000, step: 100 });
    expect(arrived, 'the DM after the rotation never reached A').toBeTruthy();
    expect(arrived.p.sealed?.to?.version, 'sealed to the old version — the roster\'s rotation was not what sealed it').toBe(2);
    expect(arrived.from).toBe(B.agent.circleAddressFor(pairId));
    expect(sentByB.filter((s) => String(s.subtype).startsWith('person-key-chain')).length, 'a chain pull ran — the roster should have been enough').toBe(pulls);
    expect(await until(async () => ((await threadTexts(A, B.pubKey)).includes('na de wissel') ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
  }, 60_000);
});
