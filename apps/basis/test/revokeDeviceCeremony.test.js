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
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'kring-revoke-test';

const rowFor = async (node, webid) => {
  const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
  return (res?.members ?? []).find((m) => m.webid === webid) ?? null;
};

describe('the device-revocation ceremony — enroll, then evict the device everywhere', () => {
  let A; let B; let A2;

  beforeAll(async () => {
    const logOpts = () => ({ agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    [A, B] = await Promise.all([bootRealAgentNode('A', logOpts()), bootRealAgentNode('B', logOpts())]);
    await connectNodesOverBus([A, B]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Revoke walk', handle: 'bea' });
    // B ingests fanned membership statements through the PRODUCTION peer handler (the shells'
    // exact receive wiring; the harness router doesn't carry this subtype by default).
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
    A2 = await bootRealAgentNode('A2', { agentOpts: vaults });
    const addrA2 = A2.agent.circleAddressFor(GROUP);

    // BOTH device addresses reach BOTH rosters via the production announce skill — A's own first
    // (production boot re-announces per circle, recording the own row; the harness pairing skips
    // boot, so the walk performs boot's act explicitly), then the enrolled device's.
    const own = ownAnnouncementFor({ agent: A.agent, circleId: GROUP });
    const mine = ownAnnouncementFor({ agent: A2.agent, circleId: GROUP });
    for (const ann of [own, mine]) {
      for (const node of [A, B]) {
        const r = await node.agent.callSkill('stoop', 'recordCircleAddressAnnouncement', {
          groupId: GROUP, memberWebid: A.pubKey,
          circleAddress: ann.circleAddress, circleAddressProof: ann.circleAddressProof,
        });
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

    // A's OWN fold retires the address at once — and the LOSS-TAKEOVER fail-over holds: the
    // announce had made the (now-revoked) device address the primary slot, so the surviving
    // device's address takes it back.
    const aRow = await rowFor(A, A.pubKey);
    expect(aRow?.circleAddresses ?? []).not.toContain(addrA2);
    expect(aRow?.circleAddresses).toContain(addrA);
    expect(aRow?.circleAddress).toBe(addrA);
    // …and B's follows over the wire, through the production ingest + fold.
    await until(async () => {
      const row = await rowFor(B, A.pubKey);
      return row && !(row.circleAddresses ?? []).includes(addrA2) ? row : null;
    }, { timeout: 15000, step: 100 });
    // the MEMBER stays, on both ends
    expect(await rowFor(A, A.pubKey)).toBeTruthy();
    expect(await rowFor(B, A.pubKey)).toBeTruthy();

    // idempotent: revoking again is still ok (the tombstone already stands)
    const again = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId, circleIds: [GROUP] });
    expect(again.ok).toBe(true);
  }, 120_000);
});
