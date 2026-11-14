/**
 * THE JOIN'S REPLY IS A HINT IN THE SAFE DIRECTION ONLY. The admitting admin's reply is an unsigned object from one
 * device; the circle's real policy travels as signed statements through the policy lane's gate. So from the reply the
 * joiner adopts ONLY the storage posture, and ONLY when it seals: the circle is then known sealed at once (nothing can be
 * written in the clear). A reply that says unsealed, or carries no posture, adopts nothing: the circle stays pending
 * (refused) until the signed policy arrives. No other field is taken from the reply; the lane's write overrides the hint.
 */
import { describe, it, expect } from 'vitest';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { sealedAnswer } from '../../src/v2/circlePodProducer.js';
import { makeCircleReachable } from '../../src/v2/householdRosterPairing.js';

const memIo = () => { const m = new Map(); return { load: async (id) => m.get(id) ?? null, save: async (id, v) => { m.set(id, v); } }; };
const fresh = () => { const p = memIo(); return createCirclePolicyStore({ load: p.load, save: p.save, marks: memIo() }); };
const join = (store, circleId, postureHint) => makeCircleReachable({
  agent: {}, circleId, postureHint,
  markPolicyPending: (cid) => store.markPending(cid),
  hintSealedPosture: (cid, p) => store.hintSealedPosture(cid, p),
}).catch(() => null);

describe('the join reply\'s posture is a hint in the safe direction only', () => {
  it('a reply that says p0 for a circle whose signed policy is p2: the joiner stays pending, a post is refused', async () => {
    const store = fresh();
    await join(store, 'c', 'p0');
    const p = await store.get('c');
    expect(p.policyPending).toBe(true);
    expect(sealedAnswer(p), 'not known: refused').toBeNull();
    // the signed policy arrives: p2, known
    await store.update('c', { storagePosture: 'p2' }, { seen: true });
    expect(sealedAnswer(await store.get('c'))).toBe(true);
  });

  it('a reply with no posture adopts nothing', async () => {
    const store = fresh();
    await join(store, 'c', null);
    expect((await store.get('c')).policyPending).toBe(true);
  });

  it('a reply that says p2: known sealed at once; no other setting is taken from it', async () => {
    const store = fresh();
    await join(store, 'c', 'p2');
    const p = await store.get('c');
    expect(p.policyPending ?? false).toBe(false);
    expect(p.storagePosture).toBe('p2');
    expect(sealedAnswer(p)).toBe(true);
    // the hinted store holds the defaults for everything else (the reply's other fields are never read)
    expect(p.llmTool).toBe((await fresh().get('other')).llmTool);
  });

  it('the hint never touches a circle whose policy was already seen here', async () => {
    const store = fresh();
    await store.update('c', { storagePosture: 'p3' }, { seen: true });
    await join(store, 'c', 'p2');
    expect((await store.get('c')).storagePosture).toBe('p3');
  });

  it('the lane\'s signed policy overrides the hint and clears the mark', async () => {
    const store = fresh();
    await join(store, 'c', 'p2');
    await store.update('c', { storagePosture: 'p3', llmTool: (await store.get('c')).llmTool }, { seen: true });
    const p = await store.get('c');
    expect(p.storagePosture).toBe('p3');
    expect(p.postureFromJoinReply ?? false).toBe(false);
  });

  it('only a sealed posture is accepted by the store itself', async () => {
    const store = fresh();
    await store.markPending('c');
    expect(await store.hintSealedPosture('c', 'p0')).toBe(false);
    expect(await store.hintSealedPosture('c', 'p1')).toBe(false);
    expect(await store.hintSealedPosture('c', 'nonsense')).toBe(false);
    expect((await store.get('c')).policyPending).toBe(true);
  });
});
