/**
 * S6 PROBE — the peer-bridge redeem at a skewed clock, isolated. THROWAWAY.
 */
import { describe, it } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, createCircle, teardown } from '../support/pairRealAgents.js';
import { buildCircleInviteUri } from '../../src/v2/circleInvite.js';
import { decodeInvite } from '../../src/core/wizards/joinGroupState.js';

const dec = (uri) => { const st = {}; decodeInvite(uri, st); return st.invite; };
const MIN = 60_000;
function timeTravel(ms) { const real = Date.now; Date.now = () => real() + ms; return () => { Date.now = real; }; }

describe('S6 probe — peer redeem at +2h', () => {
  it('sends the group-redeem-request directly', async () => {
    const admin = await bootRealAgentNode('wAdmin');
    const joiner = await bootRealAgentNode('wJoiner');
    await connectAgentsOverBus(admin, joiner);
    const groupId = 'wire-circle';
    await createCircle(admin, { groupId, name: 'Wire' });
    const built = await buildCircleInviteUri({
      callSkill: (a, o, g) => admin.agent.callSkill(a, o, g), circleId: groupId, adminPeerAddr: admin.pubKey,
    });
    const inv = dec(built.uri);

    // warm the handshake at the real clock
    const warm = await joiner.sendPeerRedeem({
      adminPeerAddr: admin.pubKey, groupId, code: inv.code, shareCard: true, peerDisplay: 'warmup',
    }).catch((e) => ({ threw: e?.message }));
    console.log('T+0 peer redeem:', JSON.stringify(warm));

    for (const [label, off] of [['+16min', 16 * MIN], ['+2h', 2 * 60 * MIN], ['+25h', 25 * 60 * MIN]]) {
      const restore = timeTravel(off);
      const r = await joiner.sendPeerRedeem({
        adminPeerAddr: admin.pubKey, groupId, code: inv.code, shareCard: true, peerDisplay: `p${label.replace(/\W/g, '')}`,
      }).catch((e) => ({ threw: e?.message }));
      restore();
      console.log(`${label} peer redeem:`, JSON.stringify(r));
    }
    await teardown(admin, joiner);
  }, 120_000);
});
