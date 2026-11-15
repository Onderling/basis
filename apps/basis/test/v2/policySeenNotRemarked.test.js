/**
 * A CIRCLE WHOSE POLICY THIS DEVICE HAS SEEN IS NEVER MARKED PENDING AGAIN. The per-circle arrival step runs again for
 * circles a device already holds (a sibling's carry repeats; an enrolment or a restore onto a device that has some of
 * the circles; a re-join). Marking such a circle pending would refuse every sealed write until a policy statement happens
 * to arrive again, which for a settled circle may be never. 'Seen' rests on: this run's knowledge, the stored mark
 * (`pending: false`), and, when the marks store is gone, the circle's policy RECORD carrying a posture (a record written
 * while the circle was pending does not carry one, so it does not count).
 */
import { describe, it, expect } from 'vitest';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { sealedAnswer } from '../../src/v2/circlePodProducer.js';
import { consumeCircleEntry } from '../../src/v2/enrollOffer.js';
import { makeCircleReachable } from '../../src/v2/householdRosterPairing.js';

const memIo = () => { const m = new Map(); return { m, load: async (id) => m.get(id) ?? null, save: async (id, v) => { m.set(id, v); } }; };
const storeOver = (policy, marks) => createCirclePolicyStore({ load: policy.load, save: policy.save, marks });

describe('a circle whose policy was seen here is not marked pending again', () => {
  it('the same run: marked again → still known, a sealed post still goes', async () => {
    const store = storeOver(memIo(), memIo());
    await store.markPending('c');
    await store.update('c', { storagePosture: 'p2' }, { seen: true });
    await store.markPending('c');
    const p = await store.get('c');
    expect(p.policyPending ?? false).toBe(false);
    expect(sealedAnswer(p)).toBe(true);
  });

  it('after a restart (the stored mark says seen)', async () => {
    const policy = memIo(); const marks = memIo();
    const a = storeOver(policy, marks);
    await a.markPending('c');
    await a.update('c', { storagePosture: 'p2' }, { seen: true });
    const b = storeOver(policy, { load: marks.load, save: marks.save });   // a new run over the same storage (fresh memory)
    await b.markPending('c');
    expect((await b.get('c')).policyPending ?? false).toBe(false);
  });

  it('the marks store wiped, the policy record still there: the record counts', async () => {
    const policy = memIo();
    const a = storeOver(policy, memIo());
    await a.markPending('c');
    await a.update('c', { storagePosture: 'p2' }, { seen: true });
    const b = storeOver(policy, memIo());   // marks gone
    await b.markPending('c');
    const p = await b.get('c');
    expect(p.policyPending ?? false).toBe(false);
    expect(p.storagePosture).toBe('p2');
  });

  it('a circle this device created (its record written, never pending) is not marked by a carry back to it', async () => {
    const store = storeOver(memIo(), memIo());
    await store.update('mine', { storagePosture: 'p2' });
    await store.markPending('mine');
    expect((await store.get('mine')).policyPending ?? false).toBe(false);
  });

  it('a record written WHILE pending (a feature toggle) does not count as seen', async () => {
    const policy = memIo();
    const a = storeOver(policy, memIo());
    await a.markPending('c');
    await a.update('c', { features: { calendar: true } });   // the joiner's own toggle, before the policy arrived
    expect((await a.get('c')).policyPending).toBe(true);
    const b = storeOver(policy, memIo());   // marks gone
    await b.markPending('c');
    expect((await b.get('c')).policyPending, 'still not known').toBe(true);
    expect((await b.get('c')).features.calendar, 'the toggle kept').toBe(true);
  });

  it('the arrival step run again for a circle already held: not pending, a post still goes', async () => {
    const store = storeOver(memIo(), memIo());
    await store.markPending('held');
    await store.update('held', { storagePosture: 'p2' }, { seen: true });
    const agent = { relays: { has: () => true }, addRelay: async () => {}, persona: () => ({}) };
    await consumeCircleEntry(
      { agent, callSkill: async () => ({}), sendPeerMessage: async () => ({}), markPolicyPending: (cid) => store.markPending(cid) },
      { id: 'held', address: 'addr-sibling', relays: [] },
    ).catch(() => null);
    const p = await store.get('held');
    expect(p.policyPending ?? false).toBe(false);
    expect(sealedAnswer(p)).toBe(true);
  });
  it('the join\'s post-step for a circle already held (a re-join): not pending, a post still goes', async () => {
    const store = storeOver(memIo(), memIo());
    await store.markPending('rejoined');
    await store.update('rejoined', { storagePosture: 'p2' }, { seen: true });
    await makeCircleReachable({ agent: {}, circleId: 'rejoined', markPolicyPending: (cid) => store.markPending(cid) }).catch(() => null);
    const p = await store.get('rejoined');
    expect(p.policyPending ?? false).toBe(false);
    expect(sealedAnswer(p)).toBe(true);
  });
});
