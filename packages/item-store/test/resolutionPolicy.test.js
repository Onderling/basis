/**
 * The DECLARATION LAYER (task #34) — the (item-type, field) → resolution policy registry + the
 * receiver-enforced put dispatch.
 *
 * @guard G-L23 — resolution policy is DECLARED per (item-type,field), receiver-enforced, behaviour-preserving
 *
 * The load-bearing claim is BEHAVIOUR-PRESERVING (this is convergence-critical): the declared policies must
 * reproduce today's dispatch exactly — task claim-fields → claim (first-wins), other content → content-LWW —
 * while the receiver now decides by the DECLARED policy, not by sniffing the payload for claim fields.
 */
import { describe, it, expect } from 'vitest';
import {
  RESOLUTION, DELIVERY,
  createResolutionRegistry, defaultResolutionRegistry, resolutionRegistryFromManifests, deliveryForResolution,
} from '../src/resolutionPolicy.js';
import { CLAIM_FIELDS } from '../src/causalMerge.js';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import tasksManifest from '../../../apps/tasks-v0/manifest.js';

describe('resolution registry — the safe code floor', () => {
  const r = defaultResolutionRegistry();

  it('declares the whole task CLAIM cluster as first-wins claim (mirrors causalMerge CLAIM_FIELDS)', () => {
    for (const f of CLAIM_FIELDS) expect(r.resolutionOf('task', f)).toBe(RESOLUTION.CLAIM);
    expect(r.hasChannel('task', RESOLUTION.CLAIM)).toBe(true);
  });

  it('resolves every unregistered (type,field) to the conservative content default', () => {
    expect(r.resolutionOf('task', 'text')).toBe(RESOLUTION.CONTENT);
    expect(r.resolutionOf('note', 'body')).toBe(RESOLUTION.CONTENT);
    expect(r.resolutionOf('chat-message', 'assignee')).toBe(RESOLUTION.CONTENT); // a non-task's stray claim field is NOT a claim
    expect(r.hasChannel('note', RESOLUTION.CLAIM)).toBe(false);
    expect(r.hasChannel('chat-message', RESOLUTION.CLAIM)).toBe(false);
  });

  it('delivery tier is DERIVED from the policy (§5), not a second table', () => {
    expect(deliveryForResolution(RESOLUTION.CONTENT)).toBe(DELIVERY.BEST_EFFORT);
    expect(deliveryForResolution(RESOLUTION.CLAIM)).toBe(DELIVERY.AT_LEAST_ONCE);
    expect(deliveryForResolution(RESOLUTION.SPINE)).toBe(DELIVERY.RELIABLE);
    expect(r.deliveryOf('task', 'assignee')).toBe(DELIVERY.AT_LEAST_ONCE);
    expect(r.deliveryOf('task', 'text')).toBe(DELIVERY.BEST_EFFORT);
  });

  it('rejects an unknown policy at declare time', () => {
    expect(() => createResolutionRegistry().declare('task', 'x', 'lww')).toThrow(/unknown resolution/);
  });
});

describe('manifest DI — the app declares its field policies INTO the registry (invariant 5, injected down)', () => {
  it('tasks-v0 declares (task,assignee)→claim and (task,text)→content, layered over the floor', () => {
    const reg = resolutionRegistryFromManifests(tasksManifest);
    expect(reg.resolutionOf('task', 'assignee')).toBe(RESOLUTION.CLAIM);
    expect(reg.resolutionOf('task', 'text')).toBe(RESOLUTION.CONTENT);
    // the floor survives — the whole cluster is still claim even though the manifest only names `assignee`
    for (const f of CLAIM_FIELDS) expect(reg.resolutionOf('task', f)).toBe(RESOLUTION.CLAIM);
  });

  it('the manifest declaration AGREES with the safe floor (no drift between the two layers)', () => {
    const floor = defaultResolutionRegistry();
    const reg = resolutionRegistryFromManifests(tasksManifest);
    expect(reg.resolutionOf('task', 'assignee')).toBe(floor.resolutionOf('task', 'assignee'));
  });
});

// ── The behaviour-preserving proof, at the put funnel ──────────────────────────────────────────────────────
const mk = (resolution) => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/', resolution });
const inbound = { origin: true, sync: false };

describe('receiver-enforced put dispatch is behaviour-preserving', () => {
  it('a task claim still wins first-come across a concurrent partition (claim path, unchanged)', async () => {
    const store = mk();   // default floor
    await store.put({ id: 't1', type: 'task', text: 'wash up', clock: 1, updatedBy: 'a' });
    // Two partitioned claims at the same clock; earliest claimedAt is the first-come winner.
    await store.put({ id: 't1', type: 'task', text: 'wash up', assignee: 'bob',   claimedAt: 200, clock: 2, updatedBy: 'z' }, inbound);
    await store.put({ id: 't1', type: 'task', text: 'wash up', assignee: 'alice', claimedAt: 100, clock: 2, updatedBy: 'a' }, inbound);
    expect((await store.get('t1')).assignee).toBe('alice');   // first-come, not last-received
  });

  it('a NON-task carrying a stray claim field is resolved by content-LWW — the receiver ignores the sniff', async () => {
    const store = mk();
    await store.put({ id: 'n1', type: 'note', text: 'v1', clock: 5, updatedBy: 'a' });
    // A causally-newer inbound "note" carries an assignee it should NOT get claim semantics for: content-LWW,
    // the latest edit wins whole. (Under the old always-reconcile sniff this would have first-wins-locked the
    // assignee; the receiver-enforced layer refuses, since `note` declares no claim channel.)
    await store.put({ id: 'n1', type: 'note', text: 'v2', assignee: 'squatter', claimedAt: 1, clock: 6, updatedBy: 'b' }, inbound);
    const got = await store.get('n1');
    expect(got.text).toBe('v2');
    expect(got.assignee).toBe('squatter');   // carried as plain content, but by LWW — not a locked first-wins claim
  });

  it('content-LWW for a task body: a causally-older inbound edit does not clobber a newer local one', async () => {
    const store = mk();
    // Seed via origin so the literal clock survives (a LOCAL write re-stamps clock from the counter).
    await store.put({ id: 't2', type: 'task', text: 'newer', clock: 10, updatedBy: 'a' }, inbound);
    await store.put({ id: 't2', type: 'task', text: 'older', clock: 3, updatedBy: 'b' }, inbound);
    expect((await store.get('t2')).text).toBe('newer');
  });

  it('a store with NO injected registry falls back to the floor (same claim behaviour) — no test-path regression', async () => {
    const store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' });
    await store.put({ id: 't3', type: 'task', text: 'x', clock: 1, updatedBy: 'a' });
    await store.put({ id: 't3', type: 'task', text: 'x', assignee: 'first',  claimedAt: 100, clock: 2, updatedBy: 'a' }, inbound);
    await store.put({ id: 't3', type: 'task', text: 'x', assignee: 'second', claimedAt: 200, clock: 2, updatedBy: 'z' }, inbound);
    expect((await store.get('t3')).assignee).toBe('first');
  });
});
