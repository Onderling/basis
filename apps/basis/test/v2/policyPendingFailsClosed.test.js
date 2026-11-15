/**
 * THE 'POLICY PENDING' MARK FAILS CLOSED. A joined circle's posture is not known until its policy arrived; the mark that
 * says so lives in device storage. A storage error must never put the circle back to 'no record = plaintext': a mark
 * that cannot be READ counts as pending, and a mark that cannot be WRITTEN is said in the refusal log and held in memory
 * for this run, so the circle stays not-known until its policy arrives.
 */
import { describe, it, expect } from 'vitest';
import { createCirclePolicyStore, localPolicyPendingMarks } from '../../src/v2/circlePolicyStore.js';
import { sealedAnswer } from '../../src/v2/circlePodProducer.js';

const memIo = () => { const m = new Map(); return { load: async (id) => m.get(id) ?? null, save: async (id, v) => { m.set(id, v); } }; };

describe('the policy-pending mark fails closed', () => {
  it('a mark that cannot be read counts as pending: the post is refused', async () => {
    const store = createCirclePolicyStore({ ...memIo(), marks: { load: async () => { throw new Error('storage gone'); }, save: async () => {} } });
    const p = await store.get('c1');
    expect(p.policyPending).toBe(true);
    expect(sealedAnswer(p), 'not known: a scoped write is refused').toBeNull();
  });

  it('a mark that cannot be written is held in memory for the run (and said): still not known', async () => {
    const said = [];
    const store = createCirclePolicyStore({
      ...memIo(),
      marks: { load: async () => null, save: async () => { throw new Error('quota'); } },
      onMarkNotWritten: (why) => said.push(why),
    });
    await store.markPending('c1');
    expect((await store.get('c1')).policyPending, 'the mark held in memory').toBe(true);
    expect(said.length, 'the failed write is said').toBe(1);
    // the circle's policy arrives: known from here on, in memory too
    await store.update('c1', { storagePosture: 'p2' }, { seen: true });
    const after = await store.get('c1');
    expect(after.policyPending ?? false).toBe(false);
    expect(sealedAnswer(after)).toBe(true);
  });

  it('a circle never marked (created here) reads as before', async () => {
    const store = createCirclePolicyStore({ ...memIo(), marks: memIo() });
    expect((await store.get('mine')).policyPending ?? false).toBe(false);
  });
  it('the hold binds EVERY store over the same storage (the phone builds several): an unwritten mark still refuses', async () => {
    const storage = { getItem: async () => null, setItem: async () => { throw new Error('quota'); } };
    const policy = memIo();
    const marker = createCirclePolicyStore({ ...policy, marks: localPolicyPendingMarks(storage), onMarkNotWritten: () => {} });
    const reader = createCirclePolicyStore({ ...policy, marks: localPolicyPendingMarks(storage) });   // the lane's, the launcher's
    await marker.markPending('c1');
    const p = await reader.get('c1');
    expect(p.policyPending, 'the other store sees the held mark').toBe(true);
    expect(sealedAnswer(p)).toBeNull();
  });
});
