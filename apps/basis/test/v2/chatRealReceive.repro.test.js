import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';

// REPRO: a circle chat fanned as a SIGNED STATEMENT (the one live path) is VERIFIED at the receiver's
// chat rail and lands as the render entry the bubbles read. The legacy-paired circle records no
// circleAddress rows, so the binding is supplied explicitly (the same shape the governance repro uses).
describe('REPRO — circle chat via the REAL receiver (InternalTransport)', () => {
  it('a signed statement A -> B verifies at the rail and renders', async () => {
    const A = await bootRealAgentNode('A');
    const aCid = await A.agent.circleIdentityFor('peer-circle');
    const B = await bootRealAgentNode('B', {
      verifyChatBinding: async ({ author, ref }) => ref === A.pubKey && author === aCid.pubKey,
    });
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B);
    const groupId = 'peer-circle';
    const msgId = 'm-' + Math.random().toString(36).slice(2);
    const text = 'hello via the real receiver';
    const r = await sendCircleChat(A, { groupId, msgId, text });
    expect(r?.error).toBeUndefined();
    const got = await until(() => B.chatEvents.some((e) => e?.payload?.text === text), { timeout: 3000 });
    expect(got, 'B verified + rendered the signed chat statement').toBeTruthy();
    const landed = B.chatEvents.find((e) => e.id === msgId);
    expect(landed.payload.statement.sig).toBeTruthy();   // the proof landed with the bubble
    expect(landed.actor).toBe(A.pubKey);                 // derived from the VERIFIED authorRef
    await teardown(A, B);
  });
});
