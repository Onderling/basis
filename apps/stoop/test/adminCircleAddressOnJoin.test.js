/**
 * The ADMIN's per-circle address rides back on the redeem response (2026-07-30).
 *
 * Per-circle addressing was one-directional. At join the joiner presents its per-circle address and
 * PROVES it; the admin records it. Nothing flowed the other way — so the admin could reach the joiner,
 * while the joiner held no per-circle address for the ADMIN and fell through to their global signing
 * key. With the per-user address-fallback setting OFF (the product default) that is refused outright
 * (`resolveMemberAddress` → `blocked-by-setting`). Measured on hardware: admin→joiner chat worked,
 * joiner→admin did not.
 *
 * The property that matters, and the one asserted here: **after a join, the joiner can resolve the
 * admin to a per-circle address with `allowFallback` false** — no global key involved.
 *
 * The joiner-side seam is `recordRemoteRedemption`, which is where the joiner already writes its own
 * mirror of the peer-confirmed join. It verifies the admin's proof exactly as the admin verifies the
 * joiner's on the way in (`verifyCircleLink`, deny-by-default): an address is only ever recorded when
 * its presenter proved control of the key behind it.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentIdentity, InternalBus, InternalTransport, DataPart,
  deriveCircleAddress, signCircleLinkFromSeed,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
import { resolveMemberAddress, ADDRESS_VIA } from '../src/lib/memberAddress.js';

const CIRCLE = 'buurt-42';
const ME     = 'pk-joiner';          // this device (basis binds webid === the chat signing key)
const ADMIN  = 'pk-admin';           // the admin, known to a joiner only through `confirmedBy`

/** The admin's REAL per-circle identity: an address derived from their profile seed, plus its proof. */
const ADMIN_SEED = new Uint8Array(32).fill(7);
const ADMIN_CIRCLE_ADDRESS = deriveCircleAddress(ADMIN_SEED, CIRCLE);
const ADMIN_PROOF = signCircleLinkFromSeed(ADMIN_SEED, CIRCLE, CIRCLE, ADMIN_CIRCLE_ADDRESS);

/** A joiner-side agent whose reliable sender records the addresses the fan is handed. */
async function buildJoinerBundle({ sends = [], members = [] } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ME, peers: [] },
    members,
    reliableSend: async (addr) => { sends.push(addr); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, from = ME) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

/** Record the joiner's own mirror of a peer-confirmed join, as `finalSubmit` does after the response. */
async function recordJoin(bundle, over = {}) {
  return callSkill(bundle.agent, 'recordRemoteRedemption', {
    groupId: CIRCLE, code: 'ABC', codeId: 'admin-item-1', confirmedBy: ADMIN, ...over,
  });
}

/** The admin's row as the joiner's roster projects it. */
async function adminRow(bundle) {
  const roster = await callSkill(bundle.agent, 'listGroupMembers', { groupId: CIRCLE });
  return (roster.members ?? []).find((m) => m.webid === ADMIN) ?? null;
}

describe('joiner side — recording the admin per-circle address', () => {
  it('records a PROVEN admin address onto the roster row', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, {
      confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS,
      confirmedByCircleAddressProof: ADMIN_PROOF,
    });
    expect((await adminRow(bundle))?.circleAddress).toBe(ADMIN_CIRCLE_ADDRESS);
  });

  it('DROPS an unproven address — a bare claim is not enough (deny-by-default)', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, { confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS });   // no proof
    const row = await adminRow(bundle);
    expect(row).toBeTruthy();                       // the admin is still a member…
    expect(row.circleAddress).toBeUndefined();      // …just not at an address we can trust
  });

  it('DROPS a proof minted for a DIFFERENT circle (no replay across circles)', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, {
      confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS,
      confirmedByCircleAddressProof: signCircleLinkFromSeed(ADMIN_SEED, CIRCLE, 'some-other-circle', ADMIN_CIRCLE_ADDRESS),
    });
    expect((await adminRow(bundle))?.circleAddress).toBeUndefined();
  });

  it('a pre-2026-07-30 join (no address at all) still yields the admin on the roster', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle);
    const row = await adminRow(bundle);
    expect(row?.role).toBe('admin');
    expect(row?.circleAddress).toBeUndefined();
  });
});

describe('the property: joiner → admin resolves WITHOUT the global-key fallback', () => {
  it('resolves on the circle-address rung with allowFallback false', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, {
      confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS,
      confirmedByCircleAddressProof: ADMIN_PROOF,
    });

    const resolved = await resolveMemberAddress(await adminRow(bundle), {
      circleId: CIRCLE, preferCircleAddress: true, allowFallback: false,
    });

    expect(resolved.via).toBe(ADDRESS_VIA.CIRCLE);
    expect(resolved.addr).toBe(ADMIN_CIRCLE_ADDRESS);
  });

  it('…which is exactly what was BLOCKED before: no address recorded ⇒ refused', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle);   // the old shape: the admin is a bare `confirmedBy`

    const resolved = await resolveMemberAddress(await adminRow(bundle), {
      circleId: CIRCLE, preferCircleAddress: true, allowFallback: false,
    });

    expect(resolved.via).toBe(ADDRESS_VIA.NONE);
    expect(resolved.addr).toBeNull();
  });

  it('the circle fan-out addresses the admin at their per-circle address', async () => {
    const sends = [];
    const bundle = await buildJoinerBundle({ sends });
    await recordJoin(bundle, {
      confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS,
      confirmedByCircleAddressProof: ADMIN_PROOF,
    });

    await callSkill(bundle.agent, 'broadcastCircleChatStatement',
      { groupId: CIRCLE, event: { body: { hash: 'h1' }, sig: 'sig1' }, msgId: 'm-admin-1', ts: 1 });

    expect(sends).toEqual([ADMIN_CIRCLE_ADDRESS]);
  });

  it('the roster row carries the pair {pubKey, circleAddress} the key binding needs', async () => {
    // `bindCircleAddressKeys` skips a row missing either half, and a per-circle address that is not
    // bound to an identity key throws `No pubKey registered` above the transport — held forever. A basis
    // circle binds webid === the chat signing key, which is what `confirmedBy` already is.
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, {
      confirmedByCircleAddress: ADMIN_CIRCLE_ADDRESS,
      confirmedByCircleAddressProof: ADMIN_PROOF,
    });
    const row = await adminRow(bundle);
    expect(row.pubKey).toBe(ADMIN);
    expect(row.circleAddress).toBe(ADMIN_CIRCLE_ADDRESS);
  });
});

describe("joiner side — the joiner's OWN row is complete AT REDEEM (wave 1 batch 5)", () => {
  // The joiner's real per-circle identity, exactly as the wizard presents it to the admin.
  const MY_SEED = new Uint8Array(32).fill(9);
  const MY_CIRCLE_ADDRESS = deriveCircleAddress(MY_SEED, CIRCLE);
  const MY_PROOF = signCircleLinkFromSeed(MY_SEED, CIRCLE, CIRCLE, MY_CIRCLE_ADDRESS);

  const myRow = async (bundle) => {
    const roster = await callSkill(bundle.agent, 'listGroupMembers', { groupId: CIRCLE });
    return (roster.members ?? []).find((m) => m.webid === ME) ?? null;
  };

  it('records signingPublicKey + a PROVEN own circleAddress onto the local row — no announce needed', async () => {
    // The canonical-only lag this ends: the ADMIN's copy of this row was complete at redeem while the
    // joiner's own mirror carried neither key nor address until a later announce healed it.
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, { circleAddress: MY_CIRCLE_ADDRESS, circleAddressProof: MY_PROOF });
    const row = await myRow(bundle);
    expect(row).toBeTruthy();
    expect(row.pubKey).toBe(ME);                        // webid === the chat signing key (basis binds them)
    expect(row.circleAddress).toBe(MY_CIRCLE_ADDRESS);  // the pair the key binding needs, complete at redeem
  });

  it('an UNPROVEN own address is dropped — one rule, every enforcement point, own device included', async () => {
    const bundle = await buildJoinerBundle();
    await recordJoin(bundle, { circleAddress: MY_CIRCLE_ADDRESS /* no proof */ });
    const row = await myRow(bundle);
    expect(row).toBeTruthy();
    expect(row.circleAddress ?? null).toBeNull();   // deriveRoster projects an absent address as null
  });
});
