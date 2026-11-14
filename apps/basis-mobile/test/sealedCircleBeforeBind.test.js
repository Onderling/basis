/**
 * A SEALED CIRCLE ASKED FOR BEFORE THE AGENT IS BOUND IS NEVER WRITTEN IN THE CLEAR (Fable's review of the producer
 * that waits for the key pair, 2026-11-14). The circle view asks for its seal strategy as it opens, which can be before
 * the agent (and so the device's per-circle key pair) is bound. "No strategy" is the plaintext answer, and the scope
 * seals only when there is one: a "none" kept for a sealed circle stored every post unsealed for the life of the app.
 *   - before the bind: no strategy is kept for the sealed circle, and a post is REFUSED (never written in the clear);
 *   - after the bind: the producer is built on it, the strategy resolves, and the post is stored sealed.
 * Driven through the shell's own functions (circlePods + the shared scope the launcher composes), not a stand-in.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { isSealed } from '@onderling/pod-client';
import { initCirclePods, getCircleSealStrategy, setCircleKeyEventWiring } from '../src/core/circlePods.js';
import { scopePinboardCallSkill } from '../../basis/src/v2/circlePinboardScope.js';
import { isSealedPosture } from '../../basis/src/v2/circlePodProducer.js';
import { useTestContentSeal } from './support/contentSeal.js';
import { bindCircleKeyPairs } from './support/circleKeyPairs.js';

useTestContentSeal();

function mockAsyncStorage() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); } };
}

describe('a sealed circle before the agent is bound', () => {
  afterAll(() => setCircleKeyEventWiring(null));

  it('refuses a post before the bind, and seals it after, with the strategy asked for first', async () => {
    initCirclePods(mockAsyncStorage());
    setCircleKeyEventWiring(null);   // the app has not bound its agent yet
    const circleId = 'sealed-before-bind';
    const policy = { storagePosture: 'p2' };
    const written = [];
    const callSkill = async (app, op, args) => { written.push({ op, args }); return { ok: true }; };
    const pinboardCall = scopePinboardCallSkill(callSkill, circleId, () => getCircleSealStrategy(circleId, policy), null,
      { sealed: () => isSealedPosture(policy.storagePosture) });

    // the circle view asks first, before the bind
    expect(await getCircleSealStrategy(circleId, policy)).toBeNull();
    await expect(pinboardCall('pinboard', 'postRequest', { text: 'vroeg' })).rejects.toThrow('sealed-circle-key-not-ready');
    expect(written, 'nothing was written in the clear').toEqual([]);

    // the agent binds: the producer that waited is built on the device's key pair
    bindCircleKeyPairs();
    let strategy = null;
    for (let i = 0; i < 50 && !strategy; i += 1) {
      strategy = await getCircleSealStrategy(circleId, policy);
      if (!strategy) await new Promise((r) => { setTimeout(r, 20); });
    }
    expect(strategy, 'the strategy resolves once the key pair is there').toBeTruthy();
    await pinboardCall('pinboard', 'postRequest', { text: 'later' });
    const post = written.find((w) => w.op === 'postRequest');
    expect(post, 'the post is written').toBeTruthy();
    expect(isSealed(post.args.text), `stored sealed, got ${String(post.args.text).slice(0, 20)}`).toBe(true);
  });
});
