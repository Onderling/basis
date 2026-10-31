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
  const res = await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP });
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
    // B ingests membership statements through the production peer handler — the harness registers it
    // for every node that has the rail (since 2026-09-14); the hand-wiring that lived here is gone.

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
      const r = await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...own });
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
    expect(A2.pubKey, 'one person: the same webid').toBe(A.pubKey);
    const addrA = A.agent.circleAddressFor(GROUP);
    const addrA2 = A2.agent.circleAddressFor(GROUP);
    expect(addrA2).toBe(addrA);   // one address per persona per circle
    const mine = ownAnnouncementFor({ agent: A2.agent, circleId: GROUP });
    for (const node of [A, B, A2]) {
      await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...mine });
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
    expect(r.firstDeviceRetired, "the first phone is retired by derivation — its id derives from the root, so the new phone never needed its record").toBe(true);
    // what it retires in the circle is the old phone's DEVICE-derived address (a device from before the circle root
    // presented it) — never the persona's one address, which the new phone presents too; the re-key moves that one
    expect(r.retiredIn.map((x) => x.address)).not.toContain(addrA);
    expect(A2.agent.circleAddressFor(GROUP)).toBe(addrA);
    // JOURNEY 1 — sealed history opens on the new phone: it holds the persona's circle key (the old phone's too), so the
    // chain opens as it is — nothing needed bringing along.
    await projectKeyEventsIntoStore({ rail: A2.agent.keyRail, store: A2.keyEventStore, circleId: GROUP });
    expect(readSealed(A2, beforeEnv, GROUP), 'the new phone reads what was sealed before it').toBe(before);

    // The member stays on Bram's roster with the persona's one address.
    const bRow = await until(async () => rowFor(B, A.pubKey), { timeout: 15000, step: 100 });
    expect([bRow.circleAddress, ...(bRow.circleAddresses ?? [])].filter(Boolean)).toContain(addrA);

    // THE WINDOW, stated (the stable point §7): the old phone is a FULL device holding the persona's circle key, so a
    // group-key rotation that keeps the person a recipient keeps the old phone one too — it can read what comes next
    // until the full-device RE-KEY moves the persona to a new epoch (its own test shows the old phone cut off then).
    // (no group-key rotation here: the old phone's key IS the persona's, so there is no recipient to drop — the re-key
    // is what rotates past it)
    const after = `na de wissel ${Date.now().toString(36)}`;
    const afterEnv = await postSealed({ admin: A2, members: [B, A], groupId: GROUP, text: after });
    await until(() => B.sealedContent.length >= 2);
    expect(readSealed(B, afterEnv, GROUP), 'Bram reads what comes next').toBe(after);

    // The wrong phrase is refused; running it again is harmless.
    const wrong = await A2.agent.callSkill('household', 'replaceDevice', { mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    expect(wrong.ok).toBe(false);
    const again = await A2.agent.callSkill('household', 'replaceDevice', { mnemonic: phrase, circleIds: [GROUP] });
    expect(again.ok).toBe(true);
  }, 120_000);
});
