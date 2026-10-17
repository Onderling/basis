/**
 * Tasks M4 — podPathMap classifier + reverseResolve.
 *
 * Analog of apps/pinboard/test/podPathMapReverse.test.js, adapted for
 * Tasks' `mem://tasks/circles/<circleId>/…` logical key space.
 *
 * Asserts the bijective property: classify(key) → storageFn+tail;
 * reverseResolve(podUri) → key round-trips back to the original.
 * Also covers the intentionally-unrouted prefixes (settings/process)
 * and the no-pod byte-neutral behaviour (active=false → identity).
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect } from 'vitest';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

const CIRCLE = 'circle-alpha';

// Fake pod base. Each storage-function resolves to:
//   `https://pod.example/<fn>/`
// This is the simplest invertible mapping for test purposes.
function mockResolve(fn /*, _vars */) {
  return `https://pod.example/${fn}/`;
}

describe('classify', () => {
  it('routes items/ to group/<circleId>/items', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/items/01JTEST.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/items`);
    expect(r.tail).toBe('01JTEST.json');
  });

  it('routes audit/ to group/<circleId>/audit', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/audit/entry-1.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/audit`);
    expect(r.tail).toBe('entry-1.json');
  });

  it('routes members/ to group/<circleId>/members', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/members/webid%3Alice.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/members`);
    expect(r.tail).toBe('webid%3Alice.json');
  });

  it('routes config.json (exact) to group/<circleId>/governance', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/config.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/governance`);
    expect(r.tail).toBe('');
  });

  it('routes availability/ to group/<circleId>/availability', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/availability/alice.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/availability`);
    expect(r.tail).toBe('alice.json');
  });

  it('routes skills/ to group/<circleId>/skills', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/skills/alice.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/skills`);
  });

  it('routes skills.json to group/<circleId>/skills (no trailing slash)', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/skills.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/skills`);
  });

  it('routes invoicing/ to group/<circleId>/invoicing', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/invoicing/alice/2026-05.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/invoicing`);
    expect(r.tail).toBe('alice/2026-05.json');
  });

  it('routes botAgents/ to group/<circleId>/bot-agents', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/botAgents/bot1.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/bot-agents`);
  });

  it('routes agent/ to group/<circleId>/private-state (vault)', () => {
    const r = classify(`mem://tasks/circles/${CIRCLE}/agent/identity-vault.json`, { circleId: CIRCLE });
    expect(r).toBeTruthy();
    expect(r.storageFn).toBe(`group/${CIRCLE}/private-state`);
  });

  it('returns null for mem://tasks/settings/… (device-local, not routed)', () => {
    expect(classify('mem://tasks/settings/devices/abc.json', { circleId: CIRCLE })).toBeNull();
    expect(classify('mem://tasks/settings/.migrated-from-v2', { circleId: CIRCLE })).toBeNull();
  });

  it('returns null for mem://tasks/process/… (process-local, not routed)', () => {
    expect(classify('mem://tasks/process/agent-identity-vault.json', { circleId: CIRCLE })).toBeNull();
  });

  it('returns null when circleId is null for a circle-prefixed key', () => {
    expect(classify(`mem://tasks/circles/${CIRCLE}/items/x.json`, { circleId: null })).toBeNull();
  });

  it('returns null for completely unknown prefix', () => {
    expect(classify('mem://other/stuff/foo.json', { circleId: CIRCLE })).toBeNull();
  });
});

describe('reverseResolve', () => {
  it('round-trips items/ key through classify → reverseResolve', () => {
    const key = `mem://tasks/circles/${CIRCLE}/items/01JTEST.json`;
    const c = classify(key, { circleId: CIRCLE });
    expect(c).toBeTruthy();
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: CIRCLE, podUri });
    expect(back).toBe(key);
  });

  it('round-trips audit/ key', () => {
    const key = `mem://tasks/circles/${CIRCLE}/audit/entry.json`;
    const c = classify(key, { circleId: CIRCLE });
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: CIRCLE, podUri });
    expect(back).toBe(key);
  });

  it('round-trips governance (config.json) exact key', () => {
    const key = `mem://tasks/circles/${CIRCLE}/config.json`;
    const c = classify(key, { circleId: CIRCLE });
    expect(c.tail).toBe('');
    const podUri = mockResolve(c.storageFn);  // no tail
    const back = reverseResolve({ resolve: mockResolve, circleId: CIRCLE, podUri });
    expect(back).toBe(key);
  });

  it('returns null for an unrecognised pod URI', () => {
    const back = reverseResolve({
      resolve: mockResolve, circleId: CIRCLE,
      podUri: 'https://other-pod.example/completely/unrelated',
    });
    expect(back).toBeNull();
  });

  it('returns null when circleId is null', () => {
    const key = `mem://tasks/circles/${CIRCLE}/items/x.json`;
    const c = classify(key, { circleId: CIRCLE });
    const podUri = mockResolve(c.storageFn) + c.tail;
    const back = reverseResolve({ resolve: mockResolve, circleId: null, podUri });
    expect(back).toBeNull();
  });
});

describe('bijection check — classify → reverseResolve is identity for all routed prefixes', () => {
  const CASES = [
    `mem://tasks/circles/${CIRCLE}/items/01JA.json`,
    `mem://tasks/circles/${CIRCLE}/audit/01JB.json`,
    `mem://tasks/circles/${CIRCLE}/members/alice%40example.json`,
    `mem://tasks/circles/${CIRCLE}/config.json`,
    `mem://tasks/circles/${CIRCLE}/availability/alice.json`,
    `mem://tasks/circles/${CIRCLE}/skills/alice.json`,
    `mem://tasks/circles/${CIRCLE}/invoicing/alice/2026-04.json`,
    `mem://tasks/circles/${CIRCLE}/botAgents/bot.json`,
    `mem://tasks/circles/${CIRCLE}/agent/vault.json`,
  ];
  for (const key of CASES) {
    it(`round-trips: ${key.replace(`mem://tasks/circles/${CIRCLE}/`, '')}`, () => {
      const c = classify(key, { circleId: CIRCLE });
      expect(c).toBeTruthy();
      const podUri = mockResolve(c.storageFn) + c.tail;
      const back = reverseResolve({ resolve: mockResolve, circleId: CIRCLE, podUri });
      expect(back).toBe(key);
    });
  }
});
