import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';

// REPRO over a REAL relay (running on :8787) via connectPeerTransport — the browser's path, on the one
// live chat path: the SIGNED statement, verified at the receiver's rail. The legacy-paired circle records
// no circleAddress rows, so the binding is supplied explicitly (the governance repro's shape).
const RELAY = process.env.PEER_TEST_RELAY || 'ws://127.0.0.1:8787';

describe('REPRO — circle chat via the REAL receiver over a REAL relay', () => {
  it('a signed statement A -> B verifies and renders over the relay', async () => {
    const A = await bootRealAgentNode('A');
    const aCid = await A.agent.circleIdentityFor('peer-circle');
    const B = await bootRealAgentNode('B', {
      verifyChatBinding: async ({ author, ref }) => ref === A.pubKey && author === aCid.pubKey,
    });
    await connectAgentsOverRelay(A, B, { relayUrl: RELAY });
    await pairCircle(A, B);
    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello over the real relay';
    const r = await sendCircleChat(A, { groupId, msgId, text });
    expect(r?.error).toBeUndefined();
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 6000 });
    expect(got, 'B verified + rendered the signed statement over the relay').toBeTruthy();
    await teardown(A, B);
  });
});
