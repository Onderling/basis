/**
 * makeNoLoginFeedbackPods — the SHARED (web ≡ mobile) no-login pod set for the invite-circle / collector
 * feedback flow. Both shells build their pods here so the mechanism can't drift between them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeNoLoginFeedbackPods } from '../../src/feedback/noLoginPods.js';
import { loadFeedbackPackage } from '../../src/feedback/feedbackPackage.js';

beforeAll(() => loadFeedbackPackage());

describe('makeNoLoginFeedbackPods', () => {
  it('without a collector: own in-memory pod only, no central route', () => {
    const { ownPod, centralPod, controlStore } = makeNoLoginFeedbackPods({});
    expect(centralPod).toBeNull();
    expect(controlStore).toBeNull();
    // the own pod is a real InMemoryCentralPod (Stage-1 store)
    expect(typeof ownPod.write).toBe('function');
    expect(typeof ownPod.list).toBe('function');
    expect(typeof ownPod.forAggregation).toBe('function');
  });

  it('with a collector: own pod + a central pod + a control store, all shaped for the verify loop', () => {
    const { ownPod, centralPod, controlStore } = makeNoLoginFeedbackPods({ collectorUrl: 'http://host:8790', participantKey: 'PK' });
    expect(typeof ownPod.write).toBe('function');
    // centralPod = the HTTP collector adapter (write / withdraw / list)
    expect(typeof centralPod.write).toBe('function');
    expect(typeof centralPod.withdraw).toBe('function');
    expect(typeof centralPod.list).toBe('function');
    // controlStore = the round control (writeRound / listRounds)
    expect(typeof controlStore.writeRound).toBe('function');
    expect(typeof controlStore.listRounds).toBe('function');
  });

  it('each call gets a FRESH own pod (per participant/thread, not shared state)', () => {
    const a = makeNoLoginFeedbackPods({});
    const b = makeNoLoginFeedbackPods({});
    expect(a.ownPod).not.toBe(b.ownPod);
  });
});
