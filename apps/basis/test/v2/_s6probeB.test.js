/**
 * S6 PROBE — section B (expiry and reuse). THROWAWAY. Delete after walking.
 */
import { describe, it, expect } from 'vitest';
import {
  bootRealAgentNode, connectAgentsOverBus, connectNodesOverBus, createCircle, joinExistingCircle,
  teardown, until, bindCircleAddresses,
} from '../support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';
import { prepareBroadcastInvite, receiveInvite, inviteActions, BROADCAST_INVITE_MAX_TTL_MS } from '../../src/v2/nearbyInvites.js';
import { decodeInvite } from '../../src/core/wizards/joinGroupState.js';

const dec = (uri) => { const st = {}; decodeInvite(uri, st); return st.invite; };

const MIN = 60_000;

/** Shift Date.now by a constant offset (real timers keep working — only the clock reading moves). */
function timeTravel(ms) {
  const real = Date.now;
  Date.now = () => real() + ms;
  return () => { Date.now = real; };
}

describe('S6 probe B', () => {
  it('J-A6 — a broadcast invite redeemed after the 15-minute ceiling', async () => {
    const admin = await bootRealAgentNode('admin');
    const mallory = await bootRealAgentNode('mallory');
    await connectAgentsOverBus(admin, mallory);
    const groupId = 'cafe-circle';
    await createCircle(admin, { groupId, name: 'Cafe' });

    const adminCall = (app, op, args) => admin.agent.callSkill(app, op, args);
    const built = await buildCircleInviteUri({ callSkill: adminCall, circleId: groupId, adminPeerAddr: admin.pubKey });
    expect(built.uri).toBeTruthy();
    console.log('INVITE expiresAt-issued-minus-now(min):', ((built.expiresAt ?? 0) - Date.now()) / MIN);

    // what the room actually broadcast
    const prepared = prepareBroadcastInvite({
      uri: built.uri, circleId: groupId, circleName: 'Cafe', expiresAt: built.expiresAt,
      allows: { [groupId]: true }, from: admin.pubKey,
    });
    console.log('BROADCAST ok:', prepared.ok, 'ttl(min):', ((prepared.invite?.expiresAt ?? 0) - Date.now()) / MIN);

    const wirePayload = { subtype: 'nearby-invite', invite: prepared.invite };

    // T+16 min: the honest client's view
    let restore = timeTravel(16 * MIN);
    const late = receiveInvite(wirePayload, admin.pubKey);
    console.log('T+16min receiveInvite:', late);
    console.log('T+16min inviteActions on the ORIGINAL object:', inviteActions(prepared.invite));

    // …and the attacker's: keep the uri, call the join op directly.
    const joined = await joinCircleFromInvite({
      inviteUri: built.uri,
      callSkill: (app, op, args) => mallory.agent.callSkill(app, op, args),
      sendPeerRedeem: mallory.sendPeerRedeem,
      handle: 'mallory',
    });
    console.log('T+16min DIRECT REDEEM:', JSON.stringify(joined));
    restore();

    const roster = await admin.agent.callSkill('stoop', 'listGroupMembers', { groupId });
    console.log('admin roster after late redeem:', JSON.stringify(roster?.members?.map?.((m) => m.peerDisplay ?? m.webid?.slice(0, 8))));

    // T+2h: the CODE's own 1h expiry has passed too
    const bo = await bootRealAgentNode('bo');
    await connectAgentsOverBus(admin, bo, { transportName: 'relay2' });
    restore = timeTravel(2 * 60 * MIN);
    const past = await joinCircleFromInvite({
      inviteUri: built.uri,
      callSkill: (app, op, args) => bo.agent.callSkill(app, op, args),
      sendPeerRedeem: bo.sendPeerRedeem,
      handle: 'bobby',
    });
    console.log('T+2h (code expired, inside 24h grace) REDEEM:', JSON.stringify(past));
    restore();

    // T+25h: past the grace window
    const cato = await bootRealAgentNode('cato');
    await connectAgentsOverBus(admin, cato, { transportName: 'relay3' });
    restore = timeTravel(25 * 60 * MIN);
    const dead = await joinCircleFromInvite({
      inviteUri: built.uri,
      callSkill: (app, op, args) => cato.agent.callSkill(app, op, args),
      sendPeerRedeem: cato.sendPeerRedeem,
      handle: 'catoo',
    });
    console.log('T+25h (past grace) REDEEM:', JSON.stringify(dead));
    restore();

    await teardown(admin, mallory, bo, cato);
  }, 120_000);

  it('J-A7 — an invite payload claiming a longer life', async () => {
    const admin = await bootRealAgentNode('admin7');
    const mallory = await bootRealAgentNode('mallory7');
    await connectAgentsOverBus(admin, mallory);
    const groupId = 'ceiling-circle';
    await createCircle(admin, { groupId, name: 'Ceiling' });
    const built = await buildCircleInviteUri({
      callSkill: (a, o, g) => admin.agent.callSkill(a, o, g), circleId: groupId, adminPeerAddr: admin.pubKey,
    });

    // 1. the broadcast layer: a payload claiming forever
    const forged = {
      subtype: 'nearby-invite',
      invite: { uri: built.uri, circleId: groupId, circleName: 'Ceiling', expiresAt: Number.MAX_SAFE_INTEGER },
    };
    const got = receiveInvite(forged, 'attacker-wire-addr');
    console.log('clamped expiresAt within ceiling?', got.expiresAt - Date.now() <= BROADCAST_INVITE_MAX_TTL_MS, got.expiresAt - Date.now());
    console.log('from is the wire addr?', got.from);

    // 2. the redeem layer: tamper the URI's OWN embedded expiresAt to forever, then redeem past the code's real life
    const decoded = dec(built.uri);
    console.log('decoded invite payload:', JSON.stringify(decoded));
    const tampered = { ...decoded, expiresAt: Number.MAX_SAFE_INTEGER };
    const restore = timeTravel(25 * 60 * MIN);
    const out = await joinCircleFromInvite({
      inviteUri: tampered,
      callSkill: (app, op, args) => mallory.agent.callSkill(app, op, args),
      sendPeerRedeem: mallory.sendPeerRedeem,
      handle: 'mallory7',
    });
    console.log('T+25h with payload claiming forever:', JSON.stringify(out));
    restore();
    await teardown(admin, mallory);
  }, 120_000);

  it('J-A8 — a rotated membership code', async () => {
    const admin = await bootRealAgentNode('admin8');
    const mallory = await bootRealAgentNode('mallory8');
    await connectAgentsOverBus(admin, mallory);
    const groupId = 'rotate-circle';
    await createCircle(admin, { groupId, name: 'Rotate' });
    const adminCall = (a, o, g) => admin.agent.callSkill(a, o, g);
    const first = await buildCircleInviteUri({ callSkill: adminCall, circleId: groupId, adminPeerAddr: admin.pubKey });
    const oldCode = dec(first.uri)?.code;

    const rot = await adminCall('stoop', 'rotateMyGroupCode', { groupId });
    console.log('rotated: old =', oldCode?.slice(0, 6), 'new =', rot?.code?.slice(0, 6));
    expect(rot.code).not.toBe(oldCode);

    const out = await joinCircleFromInvite({
      inviteUri: first.uri,
      callSkill: (app, op, args) => mallory.agent.callSkill(app, op, args),
      sendPeerRedeem: mallory.sendPeerRedeem,
      handle: 'mallory8',
    });
    console.log('JOIN WITH ROTATED-AWAY CODE:', JSON.stringify(out));
    const roster = await adminCall('stoop', 'listGroupMembers', { groupId });
    console.log('roster:', JSON.stringify(roster?.members?.map?.((m) => m.peerDisplay ?? m.webid?.slice(0, 8))));
    await teardown(admin, mallory);
  }, 120_000);

  it('J-A9 — the same invite twice (same identity, then a second identity)', async () => {
    const admin = await bootRealAgentNode('admin9');
    const mallory = await bootRealAgentNode('mallory9');
    const eve = await bootRealAgentNode('eve9');
    await connectNodesOverBus([admin, mallory, eve]);
    const groupId = 'once-circle';
    await createCircle(admin, { groupId, name: 'Once' });
    const adminCall = (a, o, g) => admin.agent.callSkill(a, o, g);
    const built = await buildCircleInviteUri({ callSkill: adminCall, circleId: groupId, adminPeerAddr: admin.pubKey });

    const one = await joinCircleFromInvite({
      inviteUri: built.uri, callSkill: (a, o, g) => mallory.agent.callSkill(a, o, g),
      sendPeerRedeem: mallory.sendPeerRedeem, handle: 'mallory9',
    });
    console.log('first redemption:', JSON.stringify(one));
    const two = await joinCircleFromInvite({
      inviteUri: built.uri, callSkill: (a, o, g) => mallory.agent.callSkill(a, o, g),
      sendPeerRedeem: mallory.sendPeerRedeem, handle: 'mallory9',
    });
    console.log('SAME identity, second redemption:', JSON.stringify(two));
    const three = await joinCircleFromInvite({
      inviteUri: built.uri, callSkill: (a, o, g) => eve.agent.callSkill(a, o, g),
      sendPeerRedeem: eve.sendPeerRedeem, handle: 'eve9',
    });
    console.log('SECOND identity, same invite:', JSON.stringify(three));

    const roster = await adminCall('stoop', 'listGroupMembers', { groupId });
    console.log('roster:', JSON.stringify(roster?.members?.map?.((m) => `${m.peerDisplay ?? '?'}:${(m.webid ?? '').slice(0, 6)}`)));
    await teardown(admin, mallory, eve);
  }, 120_000);
});
