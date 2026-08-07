/**
 * createTaskStore.spawnSubtask + .confirmClaim — the subtask decentralized-tree fix reached through the store
 * WRAPPER (the surface `apps/tasks-v0` calls). Proves the wrapper threads its construction-time rolePolicy into
 * the gate, so a pending claimant is refused and the confirmed claimant / master is allowed.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { createTaskStore } from '../src/createTaskStore.js';
import { PermissionDeniedError } from '../src/errors.js';

const MASTER = 'did:master';
const ANNE = 'did:anne';
const BRAM = 'did:bram';

// The gate the wrapper binds at construction: master/admin confirm+spawn; a confirmed claimant may spawn.
const rolePolicy = {
  canClaim: () => true,
  canConfirmClaim: (actor, item) => (item?.master ?? item?.addedBy) === actor,
  canSpawnSubtask: (actor, item) =>
    (item?.master ?? item?.addedBy) === actor || item?.confirmedAssignee === actor,
};

const mkStore = () => createTaskStore(
  new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://c/' }),
  { rolePolicy },
);

async function seedParent(store, extra = {}) {
  const [p] = await store.addItems([{ type: 'task', text: 'parent', master: MASTER, ...extra }], { actor: MASTER });
  return p;
}

describe('createTaskStore.spawnSubtask (gated on a confirmed claim, via the wrapper rolePolicy)', () => {
  it('a PENDING claimant spawns PROVISIONALLY; after confirmation new spawns are COMMITTED', async () => {
    const store = mkStore();
    const p = await seedParent(store, { claimConfirmation: 'explicit' });
    await store.claim(p.id, { actor: ANNE });                     // pending (explicit mode)

    // Not refused — an optimistic PROVISIONAL child (clearly "not yours yet"), which does not gate the parent.
    const prov = await store.spawnSubtask(p.id, { text: 'sub' }, { actor: ANNE });
    expect(prov.provisional).toBe(true);

    const confirmed = await store.confirmClaim(p.id, { actor: MASTER });
    expect(confirmed.confirmedAssignee).toBe(ANNE);

    // A confirmed claimant now spawns COMMITTED subtasks that gate the parent.
    const res = await store.spawnSubtask(p.id, { text: 'sub2' }, { actor: ANNE });
    expect(res.provisional).toBeFalsy();
    expect(res.task.containedBy).toContain(p.id);                 // containment edge established
    const parent = await store.getById(p.id);
    expect(parent.dependencies).toContain(res.task.id);          // DAG completion gate wired
  });

  it('an AUTO-confirm claim (default) unlocks the subtree in one step', async () => {
    const store = mkStore();
    const p = await seedParent(store);                            // default = auto-confirm
    await store.claim(p.id, { actor: ANNE });                     // auto-confirms
    const res = await store.spawnSubtask(p.id, { text: 'sub' }, { actor: ANNE });
    expect(res.queued).toBe(false);
    expect(res.task.containedBy).toContain(p.id);
  });

  it('the master can spawn without any claim', async () => {
    const store = mkStore();
    const p = await seedParent(store);
    const res = await store.spawnSubtask(p.id, { text: 'sub' }, { actor: MASTER });
    expect(res.task.master).toBe(MASTER);
  });

  it('confirmClaim is gated — a non-authority cannot confirm', async () => {
    const store = mkStore();
    const p = await seedParent(store, { claimConfirmation: 'explicit' });
    await store.claim(p.id, { actor: ANNE });
    await expect(store.confirmClaim(p.id, { actor: ANNE })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('claim-confirmed signing (§2.1) — a confirmer attests, a peer verifies', () => {
  // A toy Ed25519-ish signer/verifier over the same message string (deterministic HMAC-free stand-in is fine —
  // the substrate is signer-AGNOSTIC by design; production injects the identity layer's real Ed25519).
  const KEY = 'k-master';
  const sign = (msg) => `sig(${KEY}):${msg}`;
  const verify = (msg, sig) => sig === `sig(${KEY}):${msg}`;

  it('a confirmed claim carries a verifiable confirmedSig; tampering fails verification', async () => {
    const { claimConfirmationStatement, verifyClaimConfirmation } = await import('../src/taskLifecycle.js');
    const store = mkStore();
    const p = await seedParent(store, { claimConfirmation: 'explicit' });
    await store.claim(p.id, { actor: ANNE });
    const confirmed = await store.confirmClaim(p.id, { actor: MASTER, sign });

    expect(confirmed.confirmedSig).toBeTruthy();
    expect(verifyClaimConfirmation(confirmed, verify)).toBe(true);

    // Tamper: a different claimant on the item no longer verifies against the signed statement.
    expect(verifyClaimConfirmation({ ...confirmed, confirmedAssignee: BRAM }, verify)).toBe(false);
    // And the statement is deterministic (same facts → same bytes on any device).
    const stmt = claimConfirmationStatement({ taskId: p.id, confirmedAssignee: ANNE, confirmedAt: confirmed.confirmedAt, claimSeq: confirmed.claimSeq });
    expect(verify(stmt, confirmed.confirmedSig)).toBe(true);
  });

  it('the confirmedSig rides the immutable-once-set merge with its winning claim', async () => {
    const { reconcileClaim, applyClaimOverlay } = await import('../src/causalMerge.js');
    const winner = { type: 'task', id: 't', assignees: [ANNE], assignee: ANNE, claimedAt: 10, confirmedAssignee: ANNE, confirmedAt: 10, confirmedSig: 'sig-anne', claimSeq: 2 };
    const stale  = { type: 'task', id: 't', assignees: [BRAM], assignee: BRAM, claimedAt: 12, confirmedAssignee: BRAM, confirmedAt: 12, confirmedSig: 'sig-bram', claimSeq: 1 };
    const merged = applyClaimOverlay(stale, reconcileClaim(stale, winner));   // winner has higher seq
    expect(merged.confirmedAssignee).toBe(ANNE);
    expect(merged.confirmedSig).toBe('sig-anne');                             // the attestation travelled with it
  });
});

describe('claim lease / expiry (§2.8) — a lapsed claim returns the node to claimable', () => {
  it('a claim with a lease is superseded by a new claim once it lapses; without a lease it holds', async () => {
    const store = mkStore();
    // No lease → the claim holds; a 2nd claimer is refused (exclusive first-come).
    const held = await seedParent(store, {});
    await store.claim(held.id, { actor: ANNE });
    expect((await store.claim(held.id, { actor: BRAM })).error).toBe('already-claimed');

    // With a tiny lease → after it lapses, Bram's claim supersedes Anne's (fresh, re-confirmed).
    const leased = await seedParent(store, { claimLease: 1 });   // 1ms
    await store.claim(leased.id, { actor: ANNE });
    await new Promise((r) => setTimeout(r, 5));                   // let the lease lapse
    const superseded = await store.claim(leased.id, { actor: BRAM });
    expect(superseded.error).toBeUndefined();
    expect(superseded.assignee).toBe(BRAM);
    expect(superseded.confirmedAssignee).toBe(BRAM);             // auto-confirm re-ran for the new claimant
  });
});

describe('provisional subtree — optimistic spawn under a PENDING claim (§2.5)', () => {
  it('a pending claimant spawns a PROVISIONAL child that does NOT gate the parent', async () => {
    const store = mkStore();
    const p = await seedParent(store, { claimConfirmation: 'explicit' });
    await store.claim(p.id, { actor: ANNE });                    // pending (explicit)
    const res = await store.spawnSubtask(p.id, { text: 'buy paint' }, { actor: ANNE });
    expect(res.provisional).toBe(true);
    expect(res.task.provisional).toBe(true);
    expect(res.task.containedBy).toContain(p.id);
    const parent = await store.getById(p.id);
    expect(parent.dependencies ?? []).not.toContain(res.task.id);   // provisional ⇒ does NOT gate the parent
  });

  it('confirmClaim COMMITS the confirmed claimant\'s provisional subtree (it becomes real + gates)', async () => {
    const store = mkStore();
    const p = await seedParent(store, { claimConfirmation: 'explicit' });
    await store.claim(p.id, { actor: ANNE });
    const { task: prov } = await store.spawnSubtask(p.id, { text: 'buy paint' }, { actor: ANNE });
    await store.confirmClaim(p.id, { actor: MASTER });

    const child = await store.getById(prov.id);
    expect(child.provisional).toBe(false);                       // committed
    const parent = await store.getById(p.id);
    expect(parent.dependencies).toContain(prov.id);              // now gates
  });

  it('confirmClaim DISCARDS a losing claimant\'s provisional subtree, keeps the winner\'s', async () => {
    const store = mkStore();
    // Co-ownable so two claimants can both be pending in one store (models two devices' optimistic claims).
    const p = await seedParent(store, { claimConfirmation: 'explicit', maxAssignees: 2 });
    await store.claim(p.id, { actor: ANNE });
    await store.claim(p.id, { actor: BRAM });
    const { task: anneKid } = await store.spawnSubtask(p.id, { text: 'anne plan' }, { actor: ANNE });
    const { task: bramKid } = await store.spawnSubtask(p.id, { text: 'bram plan' }, { actor: BRAM });

    await store.confirmClaim(p.id, { actor: MASTER, assignee: ANNE });   // master picks Anne

    expect((await store.getById(anneKid.id))?.provisional).toBe(false);  // winner committed
    expect(await store.getById(bramKid.id)).toBeNull();                  // loser discarded
    const parent = await store.getById(p.id);
    expect(parent.dependencies).toContain(anneKid.id);
    expect(parent.dependencies ?? []).not.toContain(bramKid.id);
  });
});
