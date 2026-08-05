// Cache-mode mirroring — the TWO-AGENT end-to-end proof (slice 6). Two REAL household agents share ONLY a
// pod (the pod-only topology: members connect via the pod, no peer mesh) — so the ONLY way B can see A's
// item is through the pod, which is exactly what this must prove. A writes a household item via the real
// callSkill path → it seals + write-throughs to the shared pod; B opens the circle → catch-up enumerates the
// pod + reads through → B's listOpen shows A's item. This is the store-level analog of appTaskFanTwoDevice,
// for the pod feed instead of the peer feed.
//
// It uses a SHARED mock pod backend + a shared seal strategy (both members hold the circle group key — the
// real key exchange is proven elsewhere; here the point is the store↔pod round-trip across two real agents).
// The mock aligns local+pod uris; the real-CSS uri mapping (mem:// ↔ https) is a live-pod (.css) concern.
import { describe, it, expect, afterAll } from 'vitest';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { bootRealAgentNode } from './support/pairRealAgents.js';
import { createCircleCacheMedium } from '../src/v2/circleCacheMedium.js';

const CIRCLE = 'c1';

// One pod both agents' cache media point at, plus a visible seal (so we can assert ciphertext at rest).
function sharedPod() {
  const store = new Map();
  const backend = {
    put:  async (uri, v) => { store.set(uri, v); },
    get:  async (uri) => (store.has(uri) ? store.get(uri) : null),
    list: async (prefix = '') => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
  const strategy = { seal: (s) => `SEALED(${s})`, open: (s) => String(s).replace(/^SEALED\((.*)\)$/, '$1') };
  return { backend, strategy, store };
}

// Provision a cache-mode medium for CIRCLE that write-throughs to the shared pod; other circles → local.
const provisionFor = (label, pod) => (circleId) => (circleId === CIRCLE
  ? createCircleCacheMedium({
      localBackend: createMemoryBackend(),
      deviceId:     `${label}-${circleId}`,
      resolvePod:   async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy }),
    })
  : null);

const nodes = [];
afterAll(async () => { for (const n of nodes) { try { await n.agent?.shutdown?.(); } catch { /* best-effort */ } } });

describe('cache-mode mirroring — a task crosses two REAL agents via the shared pod (not a peer fan)', () => {
  it('A writes → seals to the pod → B catches up + opens it', async () => {
    const pod = sharedPod();
    const A = await bootRealAgentNode('A', { agentOpts: { provisionCircleMedium: provisionFor('A', pod) } });
    const B = await bootRealAgentNode('B', { agentOpts: { provisionCircleMedium: provisionFor('B', pod) } });
    nodes.push(A, B);

    // A adds a household item to the pod-backed circle — the real callSkill path (dispatch → wired op →
    // circle store over the cache medium → seal → write-through to the shared pod).
    await A.agent.callSkill('household', 'addItem', { type: 'shopping', text: 'buy milk', circleId: CIRCLE });

    // It landed on the shared pod as CIPHERTEXT (never plaintext).
    const sealedRows = [...pod.store.values()].filter((v) => typeof v === 'string' && v.startsWith('SEALED('));
    expect(sealedRows.length).toBeGreaterThan(0);

    // B has never seen this item and shares NO peer channel with A — opening the circle runs catch-up, which
    // enumerates the pod + reads through, so B's listOpen discovers A's item. (Guards the pod feed end-to-end.)
    const listed = await B.agent.callSkill('household', 'listOpen', { circleId: CIRCLE });
    const items = Array.isArray(listed?.items) ? listed.items : (Array.isArray(listed) ? listed : []);
    expect(items.some((i) => i?.text === 'buy milk'), 'B discovered A\'s item through the pod').toBe(true);
  });
});
