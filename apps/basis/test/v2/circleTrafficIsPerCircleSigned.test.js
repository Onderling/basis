/**
 * END TO END — a circle message, sent by the real agent, carries no global identity key.
 *
 * The unit tests below this one prove each piece; this one proves the pieces are CONNECTED. Decision
 * 3 shipped a seam that nothing passed through, and the only thing that would have caught it is a
 * test that reads the wire of a real send. So: two real basis agents, a real circle, the real chat
 * broadcast — and then the envelopes that actually crossed the transport are inspected.
 *
 * The claim, in the form the design states it (§12): *no envelope on a circle transport carries the
 * profile's canonical pubKey in `_from`/`_to` or as a signing key.*
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown, sendKringChat } from '../support/pairRealAgents.js';

describe('circle traffic is signed by the circle identity, end to end', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('the chat A sends into a circle names neither person on the wire', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);
    const groupId = 'buurtkring-oosterpoort';
    const { joined } = await pairCircle(A, B, { groupId, name: 'Oosterpoort', handle: 'bram' });
    expect(joined.ok).toBe(true);

    // Record only what the CHAT puts on the wire — the join handshake is contact traffic and is
    // canonical by design (there is no circle yet to speak as).
    const wire = [];
    const put = A._busTransport._put.bind(A._busTransport);
    A._busTransport._put = async (to, env) => { wire.push({ to, env }); return put(to, env); };

    const msgId = `kring-${Date.now().toString(36)}`;
    const text = 'de vergadering is verplaatst naar donderdag';
    const res = await sendKringChat(A, { groupId, text, msgId });
    expect(res.error).toBeUndefined();
    expect(await until(() => B.chatEvents.find((e) => e.id === msgId)),
      'it has to actually ARRIVE — otherwise "no canonical key on the wire" is trivially true').toBeTruthy();

    const aCircleAddress = A.agent.circleAddressFor(groupId);
    const bCircleAddress = B.agent.circleAddressFor(groupId);
    expect(wire.length).toBeGreaterThan(0);

    for (const { to, env } of wire) {
      expect(env._from, 'A spoke as its per-circle address').toBe(aCircleAddress);
      expect(to, 'and addressed B at B’s per-circle address').toBe(bCircleAddress);
    }
    const serialised = JSON.stringify(wire);
    expect(serialised, "A's global identity key is on the wire").not.toContain(A.pubKey);
    expect(serialised, "B's global identity key is on the wire").not.toContain(B.pubKey);

    // …and the signature really is the circle key's, not merely a header that says so.
    const circleIdentityA = await A.agent.circleIdentityFor(groupId);
    expect(circleIdentityA.pubKey).toBe(aCircleAddress);
    const hi = wire.find(({ env }) => env._p === 'HI');
    if (hi) expect(hi.env.payload.pubKey).toBe(circleIdentityA.pubKey);
  }, 30_000);
});
