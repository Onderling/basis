/**
 * L100 — a member's OTHER device sees the circle's traffic LIVE, not only by catch-up at connect.
 *
 * The finding (the box's phone-first enrol walk): the circle fan delivers to ONE address per member and never
 * to the sender's own other devices, so a second device followed a circle by catch-up alone. The one sibling
 * carry closes it from both sides: what a device WRITES reaches its siblings after the member fan, and what
 * LANDS on it from a member is handed on. Cast: Anna's phone (A) and Anna's always-on device (A2, enrolled
 * with the phrase, its per-circle address announced into the roster row), and Bea (B).
 *
 * Real agents over a real relay (the same composition as `contactTurnsFanTwoDevice.relay.test.js`): the
 * production send path, the production rails, the production sibling set (`siblingDevices` over the folded
 * roster row) and the production carry. No catch-up is kicked anywhere — the claim is that the always-on
 * device holds the message WITHOUT one.
 *
 * The always-on device gets its roster the way the enrol consume gives it: the ROSTER SEED, requested from the
 * phone over the production request/parcel pair. Without it the device has no row for Bea, and its sender
 * gate refuses her as a stranger (measured, 2026-09-15) — the gate doing its job, and the reason a device
 * that joined by enrolment must be seeded before it can follow a circle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND } from '@onderling/core';
import { startJourneyRelay } from '../support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { ownAnnouncementFor } from '../../src/v2/circleAddressAnnounce.js';
import { makeChatPeerHandler, CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { carryLandedStatement } from '../../src/v2/circleLanes.js';
import { EventLog } from '../../src/eventLog.js';

const GROUP = 'anna-two-devices';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };
const texts = (node) => node.chatEvents.map((e) => e.payload?.text).filter(Boolean);

describe('L100 · the one sibling carry — Anna\'s always-on device follows the circle live', () => {
  let relay; let A; let B; let A2;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const relayUrl = relay.url;
    const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    A = await bootRealAgentNode('phone', { agentOpts: { ...vaults(), ...log() } });
    B = await bootRealAgentNode('bea', { agentOpts: log() });
    await connectNodesOverRelay([A, B], { relayUrl });
    await pairCircle(A, B, { groupId: GROUP, name: 'Anna en Bea', handle: 'bea' });
    await bindCircleAddresses([A, B], GROUP);

    // Anna's second device: the ceremony runs on the NEW device (the phrase is typed there), then it boots as her.
    const secondVaults = vaults();
    const pre = await bootRealAgentNode('always-on-pre', { agentOpts: secondVaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'always-on' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('always-on', { agentOpts: { ...secondVaults, ...log() } });
    expect(A2.pubKey, 'the second device is the same person').toBe(A.pubKey);
    await connectNodesOverRelay([A2], { relayUrl });
    await bindCircleAddresses([A2], GROUP);

    // Each of Anna's devices announces its proven per-circle address into the other's roster row — the
    // production announce wire — and the phone's row on Bea grows the same way. That address SET is what
    // the sibling lookup reads.
    const announce = async (from, to) => {
      await from.agent.sendPeerMessage(to.agent.circleAddressFor(GROUP), {
        type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: GROUP,
        msgId: `announce-${from.label}-${to.label}`, ts: Date.now(),
        announcements: [ownAnnouncementFor({ agent: from.agent, circleId: GROUP })],
      }, SEND);
    };
    await announce(A2, A);
    await announce(A, A2);
    await announce(A2, B);
    const knows = (node, webid, otherAddr) => until(async () => {
      const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      const row = (res?.members ?? []).find((m) => m.webid === webid);
      return row?.circleAddresses?.includes(otherAddr) ? row : null;
    }, { timeout: 20000, step: 100 });
    expect(await knows(A, A.pubKey, A2.agent.circleAddressFor(GROUP)), 'the phone never learned its sibling\'s address').toBeTruthy();
    expect(await knows(A2, A.pubKey, A.agent.circleAddressFor(GROUP)), 'the always-on device never learned the phone\'s address').toBeTruthy();
    expect(await knows(B, A.pubKey, A2.agent.circleAddressFor(GROUP)), 'Bea never learned Anna\'s second address').toBeTruthy();

    // The roster seed: the always-on device asks the phone for the circle's trail rows (the enrol consume's act).
    const seedRequest = await A2.agent.rosterSeed.buildRequest(GROUP, A2.agent.circleAddressFor(GROUP));
    expect(seedRequest, 'the enrolled device can sign a seed request').toBeTruthy();
    await A2.agent.sendPeerMessage(A.agent.circleAddressFor(GROUP), seedRequest, SEND);
    expect(await until(async () => {
      const res = await A2.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      return (res?.members ?? []).some((m) => m.webid === B.pubKey) ? true : null;
    }, { timeout: 20000, step: 100 }), 'the always-on device never received the roster seed (no row for Bea)').toBe(true);

    // The harness composes its own router (not the shells' lane table); give BOTH of Anna's devices the
    // production RECEIVING half through the very function the lane table calls. Bea's fan delivers to ONE
    // of Anna's addresses — whichever her row lists first — and that device hands it to the other.
    for (const node of [A, A2]) {
      const receivingHalf = makeChatPeerHandler({
        rail: node.chatRail,
        onLanded: (circleId, entry, fromPeerAddr, statement) =>
          carryLandedStatement({ carry: (p, o) => node.agent.siblingCarry.carry(p, o), subtype: CHAT_STATEMENT_BROADCAST, circleId, statement, fromPeerAddr, msgId: entry?.id }),
      });
      // …and the membership lane's, the way the lane table wires it (a landed statement is carried on).
      const membershipHalf = makeMembershipPeerHandler({
        rail: node.agent.membershipRail,
        onChange: (cid) => { try { node.agent.rosterReads?.invalidate(cid); } catch { /* cache */ } },
        onLanded: (circleId, statement, fromPeerAddr) =>
          carryLandedStatement({ carry: (p, o) => node.agent.siblingCarry.carry(p, o), subtype: MEMBERSHIP_BROADCAST, circleId, statement, fromPeerAddr, msgId: `mem:${statement?.body?.hash ?? ''}` }),
      });
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => {
        if (env?.payload?.subtype === CHAT_STATEMENT_BROADCAST) return receivingHalf(env.from, env.payload);
        if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) return membershipHalf(env.from, env.payload);
        return prior?.(env);
      };
    }
  }, 180_000);

  afterAll(async () => { await teardown(A, B, A2); await relay?.close?.(); });

  it('what Anna WRITES on the phone is on the always-on device, live, with no catch-up', async () => {
    const text = `vanaf de telefoon ${Date.now().toString(36)}`;
    const msgId = `m-own-${Date.now().toString(36)}`;
    // The emitter's two halves, as the shells run them: append + member fan, then the own-write carry.
    const res = await A.chatRail.appendMessage(GROUP, { msgId, ts: Date.now(), text, actor: A.pubKey });
    expect(res?.statement).toBeTruthy();
    const fan = await A.agent.callSkill('stoop', 'broadcastCircleChatStatement', { groupId: GROUP, event: res.statement, msgId, ts: Date.now() });
    expect(fan?.error).toBeUndefined();
    const carried = await A.agent.siblingCarry.carry({ subtype: CHAT_STATEMENT_BROADCAST, circleId: GROUP, event: res.statement, msgId, ts: Date.now() });
    expect(carried.attempted, 'the production sibling set named the always-on device').toBe(1);
    expect(await until(() => (texts(A2).includes(text) ? true : null), { timeout: 10000 }), `the always-on device never received Anna's own message; it holds: ${JSON.stringify(texts(A2))}`).toBe(true);
    expect(await until(() => (texts(B).includes(text) ? true : null), { timeout: 10000 }), 'Bea received it').toBe(true);
  });

  it("what Bea writes lands on ONE of Anna's devices and is on the other, live, with no catch-up — each once", async () => {
    const text = `van bea ${Date.now().toString(36)}`;
    const msgId = `m-bea-${Date.now().toString(36)}`;
    const res = await B.chatRail.appendMessage(GROUP, { msgId, ts: Date.now(), text, actor: B.pubKey });
    const fan = await B.agent.callSkill('stoop', 'broadcastCircleChatStatement', { groupId: GROUP, event: res.statement, msgId, ts: Date.now() });
    expect(fan?.error).toBeUndefined();

    // Bea delivered to ONE of Anna's devices; the carry hands it to the other. Both hold it, each exactly once.
    expect(await until(() => (texts(A).includes(text) && texts(A2).includes(text) ? true : null), { timeout: 10000 }),
      `both of Anna's devices hold Bea's message — phone: ${JSON.stringify(texts(A))}, always-on: ${JSON.stringify(texts(A2))}`).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(texts(A).filter((t) => t === text), 'the phone holds it exactly once').toHaveLength(1);
    expect(texts(A2).filter((t) => t === text), 'the always-on device holds it exactly once').toHaveLength(1);
  });

  it('a role change Anna makes on the phone is on the always-on device\'s roster, live — the membership lane rides the same carry', async () => {
    const roleOn = async (node) => (await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP }))?.members?.find((m) => m.webid === B.pubKey)?.role ?? null;
    expect(await roleOn(A2)).toBe('member');
    const r = await A.agent.callSkill('stoop', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: 'admin' });
    expect(r?.ok ?? !r?.error, JSON.stringify(r)).toBe(true);
    expect(await until(async () => ((await roleOn(A2)) === 'admin' ? true : null), { timeout: 10000, step: 200 }),
      'the always-on device never saw the promotion Anna made on her phone').toBe(true);
  });
});
