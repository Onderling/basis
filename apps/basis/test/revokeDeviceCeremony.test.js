/**
 * THE DEVICE-REVOCATION CEREMONY (the eviction machinery pointed inward) — the stolen-device
 * story, headless: A (the owner) and B (a member) share a circle; the owner enrolls a second
 * device whose address lands in both rosters' sets; then the ceremony runs on the SURVIVING
 * device A with the phrase as the extra proof — the delegation tombstones on the registry, the
 * self-subject `address-revoke` statement folds on A immediately and fans to B, and BOTH rosters
 * retire the revoked address while the MEMBER remains. The revoked device is an island:
 * enforcement lives at the other ends (the fold feeds sender authorization, delivery, and the
 * statement binding). A wrong phrase and an unknown device both refuse.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { DEVICE_DELEGATIONS_KEY } from '@onderling/agent-registry';
import { deviceSetBindingVerifier } from '../src/v2/grantsRail.js';
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';
import { sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'circle-revoke-test';

const rowFor = async (node, webid) => {
  const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
  return (res?.members ?? []).find((m) => m.webid === webid) ?? null;
};

describe('the device-revocation ceremony — the V2 stolen-device walk', () => {
  let A; let B; let A2; let rotations;

  beforeAll(async () => {
    const logOpts = () => ({ agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    // A's control router is a SPY: V2 asserts the ceremony rotates the sealed-circle key away
    // from the revoked device's sealing key (the wiring pin; the rotation itself is pinned at the
    // control-agent level).
    rotations = [];
    const controlSpy = {
      addMember: async () => {}, removeMember: async () => {},
      grantRecipient: async () => {}, revokeRecipient: async (a) => { rotations.push(a); },
    };
    // B's chat binding = the PRODUCTION roster verifier — the harness default resolves through
    // the live node registry and would accept the island's statements forever.
    const bRef = {};
    const productionBinding = rosterBindingVerifier((app, op, args) => bRef.node.agent.callSkill(app, op, args));
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { agentOpts: { ...logOpts().agentOpts, stoopControlAgent: controlSpy } }),
      bootRealAgentNode('B', { agentOpts: logOpts().agentOpts, verifyChatBinding: productionBinding }),
    ]);
    bRef.node = B;
    await connectNodesOverBus([A, B]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Revoke walk', handle: 'bea' });
    // B ingests fanned membership statements through the PRODUCTION peer handler (the shells'
    // exact receive wiring), wired EXPLICITLY and only from here: installing it for every
    // harness node from boot changes the rail's ingest timeline during pairing and destabilises
    // the strict-verify equilibrium this walk pins (found 2026-08-15) — the rider handlers stay
    // an explicit per-test act until that interplay gets its own pass.
    const onMembership = makeMembershipPeerHandler({ rail: B.agent.membershipRail });
    const prior = B._routerRef.fn;
    B._routerRef.fn = (env) => {
      if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) return onMembership(env.from, env.payload);
      return prior?.(env);
    };
  }, 120_000);

  afterAll(async () => { await teardown(A, B, A2); });

  it('the whole ceremony', async () => {
    // ── Enroll a second device (the add-a-device ceremony, condensed). ──
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'verloren telefoon' });
    expect(enrolled.ok).toBe(true);
    const deviceId = enrolled.deviceId;
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', {
      agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) },
    });
    const addrA2 = A2.agent.circleAddressFor(GROUP);

    // BOTH device addresses reach BOTH rosters via the production announce skill — A's own first
    // (production boot re-announces per circle, recording the own row; the harness pairing skips
    // boot, so the walk performs boot's act explicitly), then the enrolled device's.
    const own = ownAnnouncementFor({ agent: A.agent, circleId: GROUP });
    const mine = ownAnnouncementFor({ agent: A2.agent, circleId: GROUP });
    for (const ann of [own, mine]) {
      for (const node of [A, B]) {
        // The whole announcement — it carries the CEREMONY COMMITMENT the revocation binds against.
        const r = await node.agent.callSkill('stoop', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...ann });
        expect(r?.ok).toBe(true);
      }
    }
    const addrA = A.agent.circleAddressFor(GROUP);
    for (const node of [A, B]) {
      const row = await rowFor(node, A.pubKey);
      expect(row?.circleAddresses).toContain(addrA);
      expect(row?.circleAddresses).toContain(addrA2);
    }

    // ── The refusals: a wrong (but valid-looking) phrase, and an unknown device. ──
    const wrong = await A.agent.callSkill('household', 'revokeDevice', {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      deviceId,
    });
    expect(wrong.outcome === 'wrong-phrase' || wrong.outcome === 'invalid-phrase').toBe(true);
    // A device this registry never saw still revokes (derivation-based; the loss-takeover case is
    // exactly a device that wasn't here) — the reply's `known:false` is the shell's typo signal.
    const unseen = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'never-enrolled-here' });
    expect(unseen.ok).toBe(true);
    expect(unseen.known).toBe(false);
    // The first ceremony that proves the phrase on a root-custody device cuts its custody over — once. Since
    // 2026-09-16 the first device already holds its own root-signed delegation from its first boot (the grants
    // floor's retirement), so the cutover keeps its derivation seed and its addresses: nothing is introduced and
    // nothing of A's is retired. Later ceremonies in this session do not migrate it again.
    expect(unseen.migrated, 'the first ceremony cut the first device over').toBe(true);
    expect(unseen.introduced ?? [], 'no address moves — the device was enrolled from its first boot').toEqual([]);

    // ── THE CEREMONY, on the surviving device. ──
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId, circleIds: [GROUP] });
    expect(r.ok).toBe(true);
    expect(r.circles).toBeGreaterThanOrEqual(1);
    expect(r.revokedIn.map((x) => x.circleId)).toContain(GROUP);
    expect(r.revokedIn.find((x) => x.circleId === GROUP).address).toBe(addrA2);

    // The registry tombstone — the durable subject revocation acts on.
    const props = (await A.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
    const rec = props[DEVICE_DELEGATIONS_KEY]?.value?.[deviceId] ?? props[DEVICE_DELEGATIONS_KEY]?.[deviceId];
    expect(rec?.revoked).toBe(true);

    expect(r.migrated, 'a second ceremony before the reload must not migrate the device again').toBeUndefined();
    // A's OWN fold retires the thief's address at once; A's own address stays (it was the device's from its
    // first boot, and the cutover kept it).
    const aRow = await rowFor(A, A.pubKey);
    expect(aRow?.circleAddresses ?? []).not.toContain(addrA2);
    expect(aRow?.circleAddresses).toContain(addrA);
    expect(aRow?.circleAddress).toBe(addrA);
    // …and B's follows over the wire, through the production ingest + fold.
    await until(async () => {
      const row = await rowFor(B, A.pubKey);
      return row && !(row.circleAddresses ?? []).includes(addrA2) ? row : null;
    }, { timeout: 15000, step: 100 });
    // the MEMBER stays, on both ends — and B really retired the address (a null from `until` must not pass)
    expect(await rowFor(A, A.pubKey)).toBeTruthy();
    const bRowAfter = await rowFor(B, A.pubKey);
    expect(bRowAfter).toBeTruthy();
    expect(bRowAfter.circleAddresses ?? [], 'B retired the revoked address').not.toContain(addrA2);

    // idempotent: revoking again is still ok (the tombstone already stands)
    const again = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId, circleIds: [GROUP] });
    expect(again.ok).toBe(true);

    // ── THE FLOOR IS GONE (2026-09-16): the SHARED profile key — the one signature the stolen device still
    //    holds — never binds on the grants lane, in peacetime or after a theft. There is no marker to close
    //    and nothing to open: every device signs with a root-signed delegation from its first boot. ──
    const verify = deviceSetBindingVerifier({ selfPubKey: 'profile-key' });
    expect(await verify({ author: 'profile-key', ref: 'profile-key', payload: {} }), 'the shared profile key never binds').toBe(false);
    expect(await verify({ author: 'profile-key', ref: 'someone-else', payload: {} })).toBe(false);
    expect(await verify({ author: 'some-device-key', ref: 'profile-key', payload: {} }), 'an unknown device key without a record does not bind either').toBe(false);

    // ── THE WAR-PROOF (custody): the stolen device CANNOT counter-revoke. The enrolled second
    //    device's circle key is delegation-derived, NOT the ceremony key; it forges an
    //    address-revoke against the owner's real address and fans it to B; B's strict binding
    //    refuses it: only a statement carrying the owner root's reveal, bound to the row's ceremony commitment, may
    //    author a revocation. ──
    const aRowB = await rowFor(B, A.pubKey);
    const survivor = aRowB.circleAddress;
    const forged = await A2.agent.membershipRail.append(GROUP, {
      kind: 'address-revoke', subject: survivor,
      payload: { by: A.pubKey }, actor: A.pubKey,
    });
    expect(forged?.statement, 'the thief CAN sign (with its own device key)').toBeTruthy();
    await B._routerRef.fn({ from: 'thief', payload: { subtype: MEMBERSHIP_BROADCAST, circleId: GROUP, event: forged.statement } });
    const after = await rowFor(B, A.pubKey);
    expect(after.circleAddress, 'B refused the forged revocation — the survivor stands').toBe(survivor);
    expect(after.circleAddresses).toContain(survivor);

    // ── THE ISLAND SPEAKS AND NOBODY LISTENS: the stolen device signs a chat statement with its
    //    (revoked) per-circle key; B's production binding no longer finds the address on the row
    //    and the statement never renders. ──
    const islandText = 'ik ben er nog';
    const islandMsg = await A2.chatRail.appendMessage(GROUP, {
      msgId: 'island-1', ts: Date.now(), text: islandText, actor: A2.pubKey,
    });
    expect(islandMsg?.statement).toBeTruthy();
    await B._routerRef.fn({ from: 'island', payload: {
      subtype: 'circle-chat-statement', circleId: GROUP,
      msgId: 'island-1', ts: Date.now(), event: islandMsg.statement, fromWebid: A2.pubKey,
    } });
    expect(B.chatEvents.find((e) => e?.payload?.text === islandText)).toBeUndefined();

    // ── THE ROTATION FIRED: the ceremony asked the sealed-key router to rotate away from the
    //    revoked device's sealing key, ban policy — nothing pod-fetchable remains for the island. ──
    expect(rotations.length).toBeGreaterThanOrEqual(1);
    // SEVERAL bans for this circle are correct, and it is worth saying why rather than taking the
    // first. Revoking by device id works for a device the registry never saw — that IS the lost-phone
    // case, and this walk exercises it a step earlier with `never-enrolled-here`. Each such ceremony
    // derives that device's address per circle and bans its sealing key. Until 2026-09-10 none of them
    // reached a circle the person had CREATED, because a founder's own circle was in no registry
    // membership list, so the ceremony's circle set was empty for it. It is covered now, which is why
    // this asserts that the THIEF's key is among the bans rather than that it is the only one.
    const banned = rotations.filter((r) => r.groupId === GROUP);
    expect(banned.length, 'the ceremony banned nothing in this circle').toBeGreaterThanOrEqual(1);
    expect(banned.every((r) => r.policy === 'ban')).toBe(true);
    expect(
      banned.map((r) => r.publicKey),
      "the stolen device's sealing key was never banned — the island can still be re-admitted by a pod fetch",
    ).toContain(sealingPublicKeyFromNetworkKey(addrA2));
    expect(
      banned.map((r) => r.publicKey),
      'the SURVIVING device was banned from its own circle',
    ).not.toContain(sealingPublicKeyFromNetworkKey(survivor));
  }, 120_000);
});
