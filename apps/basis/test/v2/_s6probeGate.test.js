/**
 * S6 PROBE — the admin-side redeem GATE in isolation. THROWAWAY.
 */
import { describe, it } from 'vitest';
import { bootRealAgentNode, createCircle, teardown } from '../support/pairRealAgents.js';
import { buildCircleInviteUri } from '../../src/v2/circleInvite.js';
import { decodeInvite } from '../../src/core/wizards/joinGroupState.js';

const dec = (uri) => { const st = {}; decodeInvite(uri, st); return st.invite; };
const MIN = 60_000;
function timeTravel(ms) { const real = Date.now; Date.now = () => real() + ms; return () => { Date.now = real; }; }

describe('S6 probe — redeem gate', () => {
  it('walks the gate at T+0 / +16min / +2h / +25h, and after rotation', async () => {
    const admin = await bootRealAgentNode('gateAdmin');
    const groupId = 'gate-circle';
    await createCircle(admin, { groupId, name: 'Gate' });
    const call = (a, o, g) => admin.agent.callSkill(a, o, g);
    const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
    const code = dec(built.uri).code;

    const attempt = async (label, offsetMs, args = {}) => {
      const restore = timeTravel(offsetMs);
      const r = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code, requesterWebid: `attacker-${label}`, peerDisplay: `att${label.replace(/\W/g, '')}`, ...args,
      });
      restore();
      console.log(`GATE ${label}:`, JSON.stringify(r));
    };

    await attempt('T+0', 0);
    await attempt('T+16min', 16 * MIN);
    await attempt('T+2h (code expired, in 24h grace)', 2 * 60 * MIN);
    await attempt('T+25h (past grace)', 25 * 60 * MIN);
    await attempt('bad code', 0, { code: 'not-the-code' });

    // rotation
    const rot = await call('stoop', 'rotateMyGroupCode', { groupId });
    console.log('rotated to', rot.code?.slice(0, 6), 'old was', code.slice(0, 6));
    await attempt('after rotation, OLD code', 0);
    await attempt('after rotation, old code T+2h', 2 * 60 * MIN);
    await attempt('after rotation, old code T+25h', 25 * 60 * MIN);

    // J-A13 — a flood of bad codes, then the honest one
    const t0 = Date.now();
    let refusals = 0;
    for (let i = 0; i < 300; i += 1) {
      const r = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code: `guess-${i}`, requesterWebid: 'guesser', peerDisplay: `g${i}`,
      });
      if (r?.error) refusals += 1;
    }
    console.log(`300 bad-code attempts: ${refusals} refused, ${Date.now() - t0}ms`);
    const honest = await call('stoop', 'verifyMembershipCodeForPeer', {
      groupId, code: rot.code, requesterWebid: 'honest-member', peerDisplay: 'honest',
    });
    console.log('honest join DURING/AFTER the flood:', JSON.stringify(honest).slice(0, 200));
    const roster = await call('stoop', 'listGroupMembers', { groupId });
    console.log('roster size after everything:', roster?.members?.length);

    // …and a flood of ACCEPTED redeems with distinct handles (a valid captured code)
    const t1 = Date.now();
    for (let i = 0; i < 300; i += 1) {
      await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code: rot.code, requesterWebid: `flood-${i}`, peerDisplay: `flood${i}`,
      });
    }
    const roster2 = await call('stoop', 'listGroupMembers', { groupId });
    console.log(`300 VALID redeems with distinct identities: ${Date.now() - t1}ms, roster size now`, roster2?.members?.length);

    await teardown(admin);
  }, 180_000);
});
