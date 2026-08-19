/**
 * THE V1 MILESTONE WALK — three devices over a REAL RELAY: A (the owner's first device) and B (a
 * member) pair a circle through the full production join; then A′ — a fresh install — ENROLLS with
 * A's phrase (the ceremony), reboots as an enrolled device, and its announcement crosses the relay
 * so that B's roster row for A grows into the ADDRESS SET holding both of A's devices — and B's
 * inbound authorization accepts the second address it just learned.
 *
 * What is production here (the point of the walk): the ceremony + enrolled boot (the real factory,
 * twice, on the same vaults) · the announcement minting (the agent's own signCircleLink) · the
 * relay transport · B's ENTIRE receive side (the real announce handler → recordCircleAddress →
 * the roster fold with the deny-by-default proof gate → bindCircleAddressKeys → the authorize
 * snapshot). The one harness hand-off: A′ learns the circle id + B's address directly — in
 * production that knowledge arrives via the registry (pod-synced) or the QR enrollment offer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown,
  sendKringChat,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';

const GROUP = 'kring-v1-walk';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

describe('V1 walk — enroll a second device, announce over a real relay, the roster set grows', () => {
  let relay; let relayUrl; let A; let B; let A2;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    // B's chat binding is the PRODUCTION verifier — `rosterBindingVerifier`, the exact one both
    // shells wire on every rail: a statement's author key must be an attested address on the
    // claimed member's roster row (primary OR the proven set). The harness's own default instead
    // resolves through the live in-process node registry and stops at the FIRST node holding the
    // ref — with two devices sharing one webid it refuses the second device by construction,
    // which is precisely the case this walk exists to prove. (And the production verifier WAS
    // primary-only until this walk caught it — the set-awareness fix is what this exercises.)
    const bRef = {};
    const productionBinding = rosterBindingVerifier((app, op, args) => bRef.node.agent.callSkill(app, op, args));
    [A, B] = await Promise.all([
      bootRealAgentNode('A'),
      bootRealAgentNode('B', { verifyChatBinding: productionBinding }),
    ]);
    bRef.node = B;
    await connectNodesOverRelay([A, B], { relayUrl });
    await pairCircle(A, B, { groupId: GROUP, name: 'V1 walk', handle: 'bea' });
  }, 120_000);

  afterAll(async () => {
    await teardown(A, B, A2);
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('the whole walk', async () => {
    // ── The ceremony on a fresh install (the phrase typed on the NEW device). ──
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(typeof phrase).toBe('string');
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'walk-device' });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);

    // ── The "reload": the enrolled boot, on the same vaults. ──
    A2 = await bootRealAgentNode('A2', { agentOpts: vaults });
    expect(A2.pubKey).toBe(A.pubKey);                       // ONE member…
    const addrA  = A.agent.circleAddressFor(GROUP);
    const addrA2 = A2.agent.circleAddressFor(GROUP);
    expect(addrA2).not.toBe(addrA);                         // …with per-DEVICE circle addresses

    // ── A′ reaches the world: relay + circle binding (production boot acts). The circle id and
    //    B's address are handed over — the registry/QR-offer's role, not this walk's subject. ──
    await connectNodesOverRelay([A2], { relayUrl });
    await bindCircleAddresses([A2], GROUP);
    await A2.agent.addCirclePeer(GROUP, B.pubKey);

    // ── The announcement: minted by A′'s own agent, carried over the REAL relay. ──
    const mine = ownAnnouncementFor({ agent: A2.agent, circleId: GROUP });
    expect(mine?.circleAddress).toBe(addrA2);
    await A2.agent.sendPeerMessage(B.pubKey, {
      type: 'p2p-chat',
      subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND,
      circleId: GROUP,
      msgId: 'v1-walk-announce',
      ts: Date.now(),
      announcements: [mine],
    }, SEND);

    // ── B's roster row for A becomes the SET — through the production receive side. ──
    const row = await until(async () => {
      const res = await B.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      const r = (res?.members ?? []).find((m) => m.webid === A.pubKey);
      return (r?.circleAddresses?.includes(addrA2) && r?.circleAddresses?.includes(addrA)) ? r : null;
    }, { timeout: 20000, step: 100 });
    expect(row.circleAddresses).toContain(addrA);
    expect(row.circleAddresses).toContain(addrA2);

    // ── The RESULT, not the dispatch: A′ SPEAKS in the circle — a chat statement signed with its
    //    per-circle key — and B verifies it against the roster row it just grew, rendering the
    //    message AS the member. This is the whole point of the set: the second device is heard. ──
    const text = 'hallo vanaf het tweede apparaat';
    // Sign through A′'s own chat rail (its per-circle key), then carry the statement to B directly
    // — the roster-driven fan has nobody to fan to on a fresh device (the same registry/QR-offer
    // hand-off as above); the wire envelope is byte-shaped like broadcastCircleChatStatement's.
    const appended = await A2.chatRail.appendMessage(GROUP, { msgId: 'v1-walk-chat', ts: Date.now(), text, actor: A2.pubKey });
    expect(appended?.statement, 'A′ signed with its per-circle identity').toBeTruthy();
    await A2.agent.sendPeerMessage(B.pubKey, {
      type: 'p2p-chat', subtype: 'kring-chat-statement',
      circleId: GROUP, msgId: 'v1-walk-chat', ts: Date.now(), event: appended.statement, fromWebid: A2.pubKey,
    }, SEND);
    const landed = await until(
      () => B.chatEvents.find((e) => e?.payload?.text === text),
      { timeout: 20000, step: 100 },
    );
    expect(landed, 'B verified + rendered the second device\'s signed chat').toBeTruthy();
    expect(landed.actor).toBe(A.pubKey);   // attributed to the MEMBER, via the address set
  }, 120_000);
});
