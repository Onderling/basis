/**
 * THE RESPONSE IS THE CARRIER of "who answered a request". A responder's answer (`respondToItem`) is a DM threaded under
 * the POSTER's request id; the poster's shell hands the host the envelope's verified sender address, and the host's own
 * `recordResponse` records the responder on the poster's copy — the webid the circle's roster binds that address to,
 * only on a request this device posted. `acceptResponder` accepts only someone recorded there.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ME = 'pk-me';
const ME_W = 'pk-me-werk';           // this device's persona in circle-w
const MEL = 'pk-mel';
const MEL_ADDR = 'addr-mel-in-b';

async function bundleFor({ sends = [] } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'circle-b', localActor: ME, peers: [] },
    members: [{ webid: ME, role: 'admin', pubKey: ME }, { webid: MEL, role: 'member', pubKey: MEL, circleAddress: MEL_ADDR }],
    selfWebidFor: (cid) => (cid === 'circle-w' ? ME_W : null),
    reliableSend: async (addr, wire) => { sends.push({ addr, wire }); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  await bundle.itemStore.addItems([
    { type: 'membership-redemption', text: 'joined', visibility: 'household', source: { groupId: 'circle-b', redeemedBy: MEL, signingPublicKey: MEL, circleAddress: MEL_ADDR } },
    { type: 'membership-redemption', text: 'joined', visibility: 'household', source: { groupId: 'circle-w', redeemedBy: MEL, signingPublicKey: MEL, circleAddress: 'addr-mel-in-w' } },
  ], { actor: ME });
  const call = (op, args, from = ME) => bundle.agent.skills.get(op).handler({ parts: [DataPart(args)], from, agent: bundle.agent, envelope: null });
  const request = (by, groupId) => bundle.itemStore.addItems([{ type: 'request', text: 'een ladder?', visibility: 'household', source: { groupId } }], { actor: by }).then(([i]) => i);
  return { bundle, call, request, sends };
}

describe('the response records who answered, on the poster\'s copy', () => {
  it('a recorded responder can be accepted; anyone else is not-a-responder', async () => {
    const { call, request } = await bundleFor();
    const req = await request(ME, 'circle-b');
    expect((await call('acceptResponder', { requestId: req.id, responderWebid: MEL })).error).toBe('not-a-responder');
    expect(await call('recordResponse', { requestId: req.id, senderAddress: MEL_ADDR })).toMatchObject({ recorded: true, webid: MEL });
    expect((await call('acceptResponder', { requestId: req.id, responderWebid: 'pk-stranger' })).error).toBe('not-a-responder');
    const r = await call('acceptResponder', { requestId: req.id, responderWebid: MEL });
    expect(r.request.assignee).toBe(MEL);
  });

  it('a newly recorded answer is announced once, so an open board re-reads it (no polling)', async () => {
    const { bundle, call, request } = await bundleFor();
    const heard = [];
    bundle.agent.on('pinboard:response-recorded', (e) => heard.push(e));
    const req = await request(ME, 'circle-b');
    await call('recordResponse', { requestId: req.id, senderAddress: MEL_ADDR });
    await call('recordResponse', { requestId: req.id, senderAddress: MEL_ADDR });   // the same answer again: nothing new
    await call('recordResponse', { requestId: req.id, senderAddress: 'addr-unknown' });   // not recorded: not announced
    expect(heard).toEqual([{ itemId: req.id }]);
  });

  it('only the host records: a peer calling it is refused; an address off the roster records nothing', async () => {
    const { call, request, bundle } = await bundleFor();
    const req = await request(ME, 'circle-b');
    expect((await call('recordResponse', { requestId: req.id, senderAddress: MEL_ADDR }, MEL)).error).toBe('not-yours');
    expect(await call('recordResponse', { requestId: req.id, senderAddress: 'addr-unknown' })).toMatchObject({ recorded: false, reason: 'sender-not-on-roster' });
    expect((await bundle.itemStore.getById(req.id)).source.responders ?? []).toEqual([]);
  });

  it("only on a request this device posted — someone else's request records nothing", async () => {
    const { call, request, bundle } = await bundleFor();
    const theirs = await request(MEL, 'circle-b');
    expect(await call('recordResponse', { requestId: theirs.id, senderAddress: MEL_ADDR })).toMatchObject({ recorded: false, reason: 'not-my-request' });
    expect((await bundle.itemStore.getById(theirs.id)).source.responders ?? []).toEqual([]);
  });

  it("in a persona's circle: the persona's request records its responder; accepting is the persona's", async () => {
    const { call, request } = await bundleFor();
    const req = await request(ME_W, 'circle-w');
    expect(await call('recordResponse', { requestId: req.id, senderAddress: 'addr-mel-in-w' })).toMatchObject({ recorded: true, webid: MEL });
    const r = await call('acceptResponder', { requestId: req.id, responderWebid: MEL });
    expect(r.request.completedBy).toBe(ME_W);
  });

  it("the answer is threaded under the poster's request id, not the responder's mirror id", async () => {
    const { bundle, call, sends } = await bundleFor();
    const [mirror] = await bundle.itemStore.addItems([{ type: 'request', text: 'een ladder?', visibility: 'household',
      source: { requestId: 'the-posters-id', broadcast: true, from: MEL, fromPubKey: MEL, groupId: 'circle-b' } }], { actor: MEL });
    const r = await call('respondToItem', { itemId: mirror.id, body: 'ja, kom maar' });
    expect(r.threadId).toBe('the-posters-id');
    const dm = sends.map((s) => s.wire).find((w) => w?.subtype === 'chat-message' || w?.parts);
    expect(JSON.stringify(dm)).toContain('the-posters-id');
    expect(JSON.stringify(dm)).not.toContain(mirror.id);
  });

  it("a 1:1 answer from the member's OWN key (not a circle address) maps through the roster too — as the shells send it", async () => {
    const { call, request } = await bundleFor();
    const req = await request(ME, 'circle-b');
    expect(await call('recordResponse', { requestId: req.id, senderAddress: MEL })).toMatchObject({ recorded: true, webid: MEL });
  });
});
