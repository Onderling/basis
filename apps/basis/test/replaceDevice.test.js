/**
 * THE REPLACE CEREMONY — journeys 1 and 2 on real agents over one bus.
 *
 *   Anna (A) admins a SEALED no-pod circle with Bram (B). Her phone is gone; the new phone (A2) is
 *   enrolled with her phrase and announces itself. She runs the replace ceremony on A2.
 *
 *   Asserted: A's old address is retired on Bram's roster (the root-revealed statement bound there); the
 *   registry says so; A2 opens the message Bram received BEFORE the wipe through the history sidecar
 *   (absorbed from A's re-derived key — nobody re-keyed anything for it); A2, as admin, rotated the group
 *   key so Bram holds v2 and A (the old phone, journey 2's thief) does not; the ceremony is idempotent.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { openAcrossKeyChain, sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { makeKeyPeerHandler, KEY_STATEMENT_BROADCAST, projectKeyEventsIntoStore, keyEventsFromRail } from '../src/v2/keyRail.js';
import { EventLog } from '../src/eventLog.js';
import { DEVICE_DELEGATIONS_KEY } from '@onderling/agent-registry';

const GROUP = 'circle-replace-walk';
const rowFor = async (node, webid) => {
  const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
  return (res?.members ?? []).find((m) => m.webid === webid) ?? null;
};
const logOpts = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });

describe('the replace ceremony — her phone is gone, the new one carries on', () => {
  let A; let B; let A2;
  afterAll(async () => { await teardown(A, B, A2); });

  it('retires the old phone everywhere, brings the sealed history along, and rotates the key past the old phone', async () => {
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { agentOpts: logOpts() }),
      bootRealAgentNode('B', { agentOpts: logOpts() }),
    ]);
    await connectNodesOverBus([A, B]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Replace walk', handle: 'bram' });
    // B ingests membership + key statements through the production peer handlers (the shells' wiring).
    const wire = (node) => {
      const onMembership = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => {
        if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) return onMembership(env.from, env.payload);
        return prior?.(env);
      };
    };
    wire(B);

    // The circle is SEALED through the real producer; A seals a message B reads — the pre-wipe history.
    await sealCircleViaProducer({ admin: A, members: [B], groupId: GROUP });
    await until(() => B.keyEvents.length >= 1);
    const before = `voor de wissel ${Date.now().toString(36)}`;
    const beforeEnv = await postSealed({ admin: A, members: [B], groupId: GROUP, text: before });
    await until(() => B.sealedContent.length >= 1);
    expect(readSealed(B, beforeEnv, GROUP)).toBe(before);

    // A's own announcement lands on both rosters (production boot does this per circle; the harness
    // pairing skips boot) — it carries A's CEREMONY COMMITMENT, which is what the ceremony binds to.
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const own = ownAnnouncementFor({ agent: A.agent, circleId: GROUP });
    expect(own.ceremonyCommitment, 'the announcement declares the commitment').toBeTruthy();
    const recordOwn = async (node) => {
      const r = await node.agent.callSkill('stoop', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...own });
      expect(r?.ok).toBe(true);
    };
    for (const node of [A, B]) await recordOwn(node);
    expect((await rowFor(B, A.pubKey))?.ceremonyCommitment).toBe(own.ceremonyCommitment);

    // ── The phone is gone. A NEW phone enrolls with her phrase (the built ceremony), reboots, announces. ──
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'nieuwe telefoon' });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { agentOpts: { ...vaults, ...logOpts() } });
    await connectNodesOverBus([A, B, A2]);
    wire(A2);
    expect(A2.pubKey, 'one person: the same webid').toBe(A.pubKey);
    const addrA = A.agent.circleAddressFor(GROUP);
    const addrA2 = A2.agent.circleAddressFor(GROUP);
    expect(addrA2).not.toBe(addrA);
    const mine = ownAnnouncementFor({ agent: A2.agent, circleId: GROUP });
    for (const node of [A, B, A2]) {
      await node.agent.callSkill('stoop', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...mine });
    }
    // The new phone knows its circle (the registry came back from the pod or the recovery file — modelled by the membership record).
    await A2.agent.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: GROUP, handle: 'anna', address: addrA2 });
    // …and holds the circle's key chain STATEMENTS (the key lane's catch-up brings them on re-open; the
    // harness performs that act explicitly by ingesting A's statements at A2's rail — it cannot OPEN them:
    // they are sealed to A's key, which is the point).
    // The circle's MEMBERSHIP trail reaches the new phone first (in production: the membership lane's
    // catch-up on re-open) — the old phone's proven address, then the statements it signed — so the key
    // lane can bind the admin's establish. Same explicit act as above, at A2's production rails.
    await recordOwn(A2);
    const onMembershipA2 = makeMembershipPeerHandler({ rail: A2.agent.membershipRail });
    for (const stmt of A.agent.membershipRail.storedStatements(GROUP)) {
      await onMembershipA2('A', { subtype: MEMBERSHIP_BROADCAST, circleId: GROUP, event: stmt });
    }
    const onKey = makeKeyPeerHandler({ rail: A2.agent.keyRail });
    for (const stmt of A.agent.keyRail.storedStatements(GROUP)) {
      await onKey('A', { subtype: KEY_STATEMENT_BROADCAST, circleId: GROUP, event: stmt });
    }
    expect(await A2.agent.historyKeyChainFor(GROUP), 'before the ceremony the sidecar is empty').toEqual([]);

    // ── THE CEREMONY, on the new phone. ──
    const r = await A2.agent.callSkill('household', 'replaceDevice', { mnemonic: phrase, circleIds: [GROUP] });
    expect(r.ok, r.error).toBe(true);
    expect(r.profileAddressRetired, "the first phone's profile-derived address is retired").toBe(true);
    expect(r.retiredIn.map((x) => x.address)).toContain(addrA);
    expect(r.historyKeys, 'the old key opened the chain; the keys came along').toBeGreaterThanOrEqual(1);

    // JOURNEY 1 — sealed history opens on the new phone, through the sidecar, with nobody re-keying anything.
    const chain = await A2.agent.historyKeyChainFor(GROUP);
    expect(openAcrossKeyChain(beforeEnv, chain)).toBe(before);

    // The old address is retired on Bram's roster — the root reveal bound there; the member stays.
    await until(async () => {
      const row = await rowFor(B, A.pubKey);
      return row && !(row.circleAddresses ?? []).includes(addrA) && (row.circleAddresses ?? []).includes(addrA2) ? row : null;
    }, { timeout: 15000, step: 100 });
    expect(await rowFor(B, A.pubKey)).toBeTruthy();

    // JOURNEY 2 — the old phone is cut off from what comes next: A2 (an admin) rotated to v2, fanned to
    // Bram (a survivor) and not to the retired sealing key.
    expect(r.rotated.map((x) => x.circleId)).toContain(GROUP);
    const v2 = r.rotated.find((x) => x.circleId === GROUP).version;
    await until(() => B.keyEventStore.has(GROUP, v2), { timeout: 15000, step: 100 });
    const events = (await A2.agent.keyRail.readVerifiedBodies(GROUP)).bodies.filter((b) => b.payload?.event?.version === v2);
    expect(events[0].payload.event.recipients).not.toContain(sealingPublicKeyFromNetworkKey(addrA));
    expect(events[0].payload.event.recipients).toContain(sealingPublicKeyFromNetworkKey(addrA2));

    // …and the old phone is REALLY cut off: content sealed under the new version opens for Bram and not for
    // the old phone, whose per-circle sealing key is not a recipient any more (one key family).
    await projectKeyEventsIntoStore({ rail: A2.agent.keyRail, store: A2.keyEventStore, circleId: GROUP });
    const after = `na de wissel ${Date.now().toString(36)}`;
    const afterEnv = await postSealed({ admin: A2, members: [B, A], groupId: GROUP, text: after });
    await until(() => B.sealedContent.length >= 2 && A.sealedContent.length >= 1);
    expect(readSealed(B, afterEnv, GROUP), 'Bram reads what comes next').toBe(after);
    expect(() => readSealed(A, afterEnv, GROUP), 'the old phone cannot').toThrow();

    // The retired address keeps its PAST: the key chain the old phone established (v1) is still
    // folded on both devices after its address was retired, because those statements landed on each log
    // before the revocation did. Without this the circle's own chain vanished with the device.
    for (const node of [A2, B]) {
      const versions = (await keyEventsFromRail(node.agent.keyRail, GROUP)).map((e) => e.version);
      expect(versions, `${node.label}: v1 by the retired device still folds`).toContain(1);
    }
    const bRowNow = await rowFor(B, A.pubKey);
    expect(bRowNow.retiredAddresses?.map((r) => r.address), 'the roster row remembers the retired address').toContain(addrA);

    // The wrong phrase is refused; running it again is harmless.
    const wrong = await A2.agent.callSkill('household', 'replaceDevice', { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    expect(wrong.ok).toBe(false);
    const again = await A2.agent.callSkill('household', 'replaceDevice', { mnemonic: phrase, circleIds: [GROUP] });
    expect(again.ok).toBe(true);
  }, 120_000);
});
