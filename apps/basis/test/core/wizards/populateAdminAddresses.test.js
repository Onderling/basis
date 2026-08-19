/**
 * Connectivity Phase 2 — PeerGraph population (unit proof).
 *
 * The address-resolution step attached the app's PeerGraph to the shared secure router so
 * `route → addressFor → PeerGraph.addressesOf` COULD resolve a peer's
 * per-transport wire address — but nothing populated the graph, so on the
 * real join path `addressesOf(adminPubKey)` returned nothing and the redeem
 * degraded to (and failed over) NKN.
 *
 * This proves the population helper closes that gap end-to-end at the unit
 * level: an invite carrying the admin's `adminPeerAddr` (the pubKey = relay
 * wire address) + `adminNknAddr` (the NKN native address), once decoded and
 * fed through `populateAdminAddressesFromInvite`, makes a REAL PeerGraph
 * resolve BOTH addresses for the admin's canonical id — no mocks, the actual
 * `@onderling/core` PeerGraph.
 */
import { describe, it, expect } from 'vitest';
import { PeerGraph } from '@onderling/core';
import { encodeMembershipCodeUrl } from '../../../src/core/wizards/createGroupState.js';
import { decodeInvite, populateAdminAddressesFromInvite } from '../../../src/core/wizards/joinGroupState.js';

const ADMIN_PUBKEY = 'AdminEd25519PubKeyBase64Url';        // relay wire address == the pubKey
const ADMIN_NKN    = 'nkn-native:abc123adminseedderived';  // NKN native address (distinct)

describe('slice 2b — populateAdminAddressesFromInvite', () => {
  it('after decoding an invite carrying both admin addresses, addressesOf resolves BOTH (relay=pubKey, nkn=native)', async () => {
    // Build the real invite URL the admin would show, then decode it as a joiner.
    const uri = encodeMembershipCodeUrl({
      groupId: 'circle-1', code: 'JOIN-CODE', expiresAt: Date.now() + 60_000,
      adminPeerAddr: ADMIN_PUBKEY, adminNknAddr: ADMIN_NKN,
    });
    const state = {};
    decodeInvite(uri, state);
    expect(state.inviteParseError).toBeUndefined();
    expect(state.invite.adminPeerAddr).toBe(ADMIN_PUBKEY);
    expect(state.invite.adminNknAddr).toBe(ADMIN_NKN);

    // Populate a real PeerGraph as the join path now does (before the redeem send).
    const graph = new PeerGraph();
    const rec = await populateAdminAddressesFromInvite({ peerGraph: graph, invite: state.invite });
    expect(rec?.pubKey).toBe(ADMIN_PUBKEY);

    // B2 — addressesOf now resolves the transport-appropriate wire address for BOTH tiers,
    // keyed by the admin's canonical id (the pubKey). This is what the redeem send consults.
    const addrs = await graph.addressesOf(ADMIN_PUBKEY);
    expect(addrs).toEqual({ relay: ADMIN_PUBKEY, nkn: ADMIN_NKN });
  });

  it('a relay-only admin (no NKN up at invite time) populates just the relay address', async () => {
    const uri = encodeMembershipCodeUrl({
      groupId: 'circle-2', code: 'C', expiresAt: 1, adminPeerAddr: ADMIN_PUBKEY,
    });
    const state = {};
    decodeInvite(uri, state);
    expect('adminNknAddr' in state.invite).toBe(false);

    const graph = new PeerGraph();
    await populateAdminAddressesFromInvite({ peerGraph: graph, invite: state.invite });
    expect(await graph.addressesOf(ADMIN_PUBKEY)).toEqual({ relay: ADMIN_PUBKEY });
  });

  it('control — an invite with no admin address (older peer-less invite) is a no-op, graph stays empty', async () => {
    const graph = new PeerGraph();
    const rec = await populateAdminAddressesFromInvite({ peerGraph: graph, invite: { groupId: 'g', code: 'x' } });
    expect(rec).toBeNull();
    expect(await graph.addressesOf('anything')).toEqual({});
    // Missing graph / missing invite are also inert (never throw into the join).
    expect(await populateAdminAddressesFromInvite({ peerGraph: null, invite: { adminPeerAddr: ADMIN_PUBKEY } })).toBeNull();
    expect(await populateAdminAddressesFromInvite({})).toBeNull();
  });
});
