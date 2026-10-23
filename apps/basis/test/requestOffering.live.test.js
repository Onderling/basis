/**
 * REQUESTABLE BRIDGE — the host-wiring seam, LIVE on the basis real agent.
 *
 * Proves the `requestOffering` peer-facing dispatcher wired onto the live host agent
 * (realAgent.js): a peer (A) invokes a local member's REQUESTABLE offering and, instead
 * of executing it, a `request`-kind task is MINTED in that circle's per-circle store —
 * the convergence "a request to a human IS a task" (NOTE-skills-vs-capabilities · J6).
 *
 * The J6 UNIT test (journeys-cluster.test.js) exercises `requestableSkillHandler` over an
 * in-memory store directly; THIS test drives the whole seam through the real composition
 * (persona resolution → the `isRequestable` guard → per-circle `createTaskStore` mint).
 *
 * `from` is the A2A caller. Invoked via `callSkill('household', 'requestOffering', …)`,
 * the caller identity is the live chat agent (a.identity.chat.pubKey) — that is requester
 * A; the recipient (forMember) is the local household member webid.
 */
import { describe, it, expect } from 'vitest';

import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const CIRCLE    = 'circle-req-test';
const OFFER_KEY = 'dogwalk';        // requestable
const OTHER_KEY = 'cooking';        // driver exists but NOT marked requestable
const RECIPIENT = 'webid:local-demo-user';   // the local member webid the host ops use

/** Boot the real composition + seed the default persona with two skill-kind drivers. */
async function boot() {
  const a = await createRealHouseholdAgent({ seedHousehold: false });

  // Two skill-kind offerings on the default (no-login) persona.
  expect((await a.callSkill('agents', 'setProfileDriver', {
    id: 'default', key: OFFER_KEY, kind: 'offering', text: 'Walk your dog', tags: 'pets,dogs',
  })).ok).toBe(true);
  expect((await a.callSkill('agents', 'setProfileDriver', {
    id: 'default', key: OTHER_KEY, kind: 'offering', text: 'Cook a meal', tags: 'food',
  })).ok).toBe(true);

  // Mark ONLY dogwalk requestable (+ matchable) in this circle; cooking stays non-requestable.
  expect((await a.callSkill('agents', 'setProfileDisclosure', {
    id: 'default', contextId: CIRCLE, key: OFFER_KEY, requestable: true, matchable: true,
  })).ok).toBe(true);

  const requesterA = a.identity.chat.pubKey;   // the live A2A caller = requester A
  return { a, requesterA };
}

describe('requestOffering (live) — the REQUESTABLE BRIDGE host-wiring seam', () => {
  it('invoking a REQUESTABLE offering mints a `request` task for the recipient (not an action)', async () => {
    const { a, requesterA } = await boot();

    const res = await a.callSkill('household', 'requestOffering', { contextId: CIRCLE, key: OFFER_KEY });

    // Resolves to a PENDING task reference, never an action result.
    expect(res.created).toBe(true);
    expect(res.status).toBe('pending');
    expect(typeof res.taskId).toBe('string');
    expect(res.taskId.length).toBeGreaterThan(0);

    // A `request`-kind task with the right provenance.
    expect(res.task.kind).toBe('request');
    expect(res.task.source.kind).toBe('requestable-skill');
    expect(res.task.source.requestedBy).toBe(requesterA);
    expect(res.task.source.forMember).toBe(RECIPIENT);
    expect(res.task.source.contextId).toBe(CIRCLE);
    expect(res.task.source.humanInTheLoop).toBe('required');
    expect(res.task.source.offering.key).toBe(OFFER_KEY);

    // Independent read-back: the task actually PERSISTED in THAT circle's store.
    const tasks = await a.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
    expect(tasks.items.some((it) => it.id === res.taskId)).toBe(true);
    expect(tasks.items.length).toBe(1);
  });

  it('invoking a NON-requestable offering returns not-requestable and mints NOTHING', async () => {
    const { a } = await boot();

    // Positive first so the circle store holds exactly one request task…
    const ok = await a.callSkill('household', 'requestOffering', { contextId: CIRCLE, key: OFFER_KEY });
    expect(ok.created).toBe(true);

    // …then the guard rejects the non-requestable key.
    const denied = await a.callSkill('household', 'requestOffering', { contextId: CIRCLE, key: OTHER_KEY });
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('not-requestable');
    expect(denied.created).toBeUndefined();
    expect(denied.taskId).toBeUndefined();

    // No second task was minted — still exactly the one from the positive call.
    const tasks = await a.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
    expect(tasks.items.length).toBe(1);
  });
});
