/**
 * Claim confirmation + the immutable-once-set claim merge — the subtask decentralized-tree fix.
 *
 * The guarantee: a subtask tree survives decentralization because only the CONFIRMED claimant writes a
 * node's subtree (single writer per node → no array clobber). This proves the three moving parts:
 *   • claim/confirm — `claim` auto-confirms by default / stays PENDING in explicit mode; `confirmClaim`
 *     (authority) turns a pending claim into a real one;
 *   • the immutable-once-set CLAIM merge — two concurrent claims resolve FIRST-COME across devices
 *     (not causally-latest), a confirmed claim beats a pending one, an authoritative transition (reassign/
 *     revoke) supersedes a stale claim, and a claimless content edit never drops the claim;
 *   • confirmed-only subtree — `spawnSubtask` only unlocks for the CONFIRMED claimant (or master/admin);
 *     a pending claim cannot accrue committed subtasks.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';

import { CircleItemStore } from '../src/CircleItemStore.js';
import {
  claim, confirmClaim, reassign, revoke, spawnSubtask,
  confirmationModeOf, confirmedClaimOf, isConfirmedClaimant, claimState,
} from '../src/taskLifecycle.js';
import { reconcileClaim, applyClaimOverlay } from '../src/causalMerge.js';
import { PermissionDeniedError } from '../src/errors.js';

const ROOT = 'pod://circle/';
const ANNE = 'https://id.example/anne';
const BRAM = 'https://id.example/bram';
const MASTER = 'https://id.example/master';

const newStore = () => new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
const seed = (store, item) => store.put({ type: 'task', ...item }, { by: 'sys' });

// A minimal role policy: the master (or admin) confirms/spawns; a plain member may claim but not confirm.
const policy = {
  canClaim: () => true,
  canConfirmClaim: (actor, item) => (item?.master ?? item?.addedBy) === actor,
  canSpawnSubtask: (actor, item) =>
    (item?.master ?? item?.addedBy) === actor || item?.confirmedAssignee === actor,
  canReassign: () => true,
  canRevoke: () => true,
};

describe('slice 1 — claim confirmation lifecycle (auto / explicit / confirmClaim)', () => {
  it('a default task AUTO-confirms the first claim (the master pre-delegates)', async () => {
    const store = newStore();
    const t = await seed(store, { id: 't', text: 't', master: MASTER });
    expect(confirmationModeOf(t)).toBe('auto');
    const res = await claim(store, 't', { actor: ANNE });
    expect(res.confirmedAssignee).toBe(ANNE);
    expect(res.confirmedBy).toBe(MASTER);                 // attribution = the pre-delegating authority
    expect(claimState(res)).toBe('confirmed');
    expect(isConfirmedClaimant(res, ANNE)).toBe(true);
  });

  it('an EXPLICIT task leaves the claim PENDING until an authority confirms it', async () => {
    const store = newStore();
    await seed(store, { id: 't', text: 't', master: MASTER, claimConfirmation: 'explicit' });
    const claimed = await claim(store, 't', { actor: ANNE });
    expect(claimed.confirmedAssignee).toBeUndefined();
    expect(claimState(claimed)).toBe('pending');          // "not yet yours"
    expect(confirmedClaimOf(claimed)).toBeNull();

    const confirmed = await confirmClaim(store, 't', { actor: MASTER, rolePolicy: policy });
    expect(confirmed.confirmedAssignee).toBe(ANNE);
    expect(confirmed.confirmedBy).toBe(MASTER);
    expect(claimState(confirmed)).toBe('confirmed');
  });

  it('confirmClaim is gated — a non-authority cannot confirm', async () => {
    const store = newStore();
    await seed(store, { id: 't', text: 't', master: MASTER, claimConfirmation: 'explicit' });
    await claim(store, 't', { actor: ANNE });
    await expect(confirmClaim(store, 't', { actor: BRAM, rolePolicy: policy }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('confirmClaim can resolve to a claimant who is NOT the current sole assignee (master picks)', async () => {
    const store = newStore();
    await seed(store, { id: 't', text: 't', master: MASTER, claimConfirmation: 'explicit' });
    await claim(store, 't', { actor: ANNE });
    const res = await confirmClaim(store, 't', { actor: MASTER, assignee: BRAM, rolePolicy: policy });
    expect(res.confirmedAssignee).toBe(BRAM);
    expect(res.assignees).toEqual([BRAM]);                // confirmation collapses to the chosen one
  });
});

describe('slice 3 — COMMITTED spawn only for the CONFIRMED claimant; a pending one goes provisional', () => {
  it('a PENDING claimant spawns PROVISIONALLY; after confirmation spawns are COMMITTED', async () => {
    const store = newStore();
    await seed(store, { id: 'p', text: 'parent', master: MASTER, claimConfirmation: 'explicit' });
    await claim(store, 'p', { actor: ANNE });

    const prov = await spawnSubtask(store, 'p', { text: 'sub' }, { actor: ANNE, rolePolicy: policy });
    expect(prov.provisional).toBe(true);                          // optimistic, not committed

    await confirmClaim(store, 'p', { actor: MASTER, rolePolicy: policy });
    const res = await spawnSubtask(store, 'p', { text: 'sub2' }, { actor: ANNE, rolePolicy: policy });
    expect(res.provisional).toBeFalsy();
    expect(res.task.id).toBeTruthy();
  });

  it('a NON-claimant (no claim at all) is refused outright', async () => {
    const store = newStore();
    await seed(store, { id: 'p', text: 'parent', master: MASTER, claimConfirmation: 'explicit' });
    // BRAM never claimed → not an assignee → neither committed nor provisional; hard deny.
    await expect(spawnSubtask(store, 'p', { text: 'sub' }, { actor: BRAM, rolePolicy: policy }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('the master can always decompose their own task, claim or no claim', async () => {
    const store = newStore();
    await seed(store, { id: 'p', text: 'parent', master: MASTER });
    const { task: child } = await spawnSubtask(store, 'p', { text: 'sub' }, { actor: MASTER, rolePolicy: policy });
    expect(child.id).toBeTruthy();
  });
});

describe('slice 2 — the immutable-once-set claim merge (reconcileClaim)', () => {
  const withClaim = (o) => ({ type: 'task', id: 't', ...o });

  it('two concurrent auto-confirmed claims → FIRST-COME wins (earliest claimedAt), not causally-latest', () => {
    const anne = withClaim({ assignees: [ANNE], assignee: ANNE, claimedAt: 10, confirmedAssignee: ANNE, confirmedAt: 10, claimSeq: 1 });
    const bram = withClaim({ assignees: [BRAM], assignee: BRAM, claimedAt: 12, confirmedAssignee: BRAM, confirmedAt: 12, claimSeq: 1 });
    // order-independent: Anne (earlier) wins whichever side is "local"
    expect(reconcileClaim(anne, bram).confirmedAssignee).toBe(ANNE);
    expect(reconcileClaim(bram, anne).confirmedAssignee).toBe(ANNE);
  });

  it('a CONFIRMED claim beats a PENDING one at the same sequence', () => {
    const pending = withClaim({ assignees: [BRAM], assignee: BRAM, claimedAt: 5, claimSeq: 1 });
    const confirmed = withClaim({ assignees: [ANNE], assignee: ANNE, claimedAt: 9, confirmedAssignee: ANNE, confirmedAt: 9, claimSeq: 1 });
    expect(reconcileClaim(pending, confirmed).confirmedAssignee).toBe(ANNE);
    expect(reconcileClaim(confirmed, pending).confirmedAssignee).toBe(ANNE);
  });

  it('a higher-sequence AUTHORITATIVE transition (reassign) supersedes a stale claim', () => {
    const stale = withClaim({ assignees: [ANNE], assignee: ANNE, claimedAt: 10, confirmedAssignee: ANNE, confirmedAt: 10, claimSeq: 1 });
    const reassigned = withClaim({ assignees: [BRAM], assignee: BRAM, claimedAt: 20, confirmedAssignee: BRAM, confirmedAt: 20, claimSeq: 2 });
    expect(reconcileClaim(stale, reassigned).confirmedAssignee).toBe(BRAM);
    expect(reconcileClaim(reassigned, stale).confirmedAssignee).toBe(BRAM);
  });

  it('a RELEASE/revoke beats a stale claim (deny wins), and is preserved by the overlay', () => {
    const stale = withClaim({ assignees: [ANNE], assignee: ANNE, claimedAt: 10, confirmedAssignee: ANNE, confirmedAt: 10, claimSeq: 1 });
    const released = withClaim({ claimSeq: 2, claimReleasedAt: 30 });    // revoke cleared the claim
    const winner = reconcileClaim(stale, released);
    expect(winner.released).toBe(true);
    const merged = applyClaimOverlay({ type: 'task', id: 't', text: 'x', assignee: ANNE, assignees: [ANNE] }, winner);
    expect(merged.assignee).toBeUndefined();
    expect(merged.confirmedAssignee).toBeUndefined();
    expect(merged.claimReleasedAt).toBe(30);
  });

  it('a claimLESS content edit never drops the claim (the original clobber, prevented)', () => {
    const claimed = withClaim({ assignees: [ANNE], assignee: ANNE, claimedAt: 10, confirmedAssignee: ANNE, confirmedAt: 10, claimSeq: 1 });
    const claimlessEdit = { type: 'task', id: 't', text: 'edited by a peer that never saw the claim' };
    expect(reconcileClaim(claimed, claimlessEdit).confirmedAssignee).toBe(ANNE);
    expect(reconcileClaim(claimlessEdit, claimed).confirmedAssignee).toBe(ANNE);
  });

  it('non-task items (no claim cluster) → null (unaffected by the claim merge)', () => {
    expect(reconcileClaim({ type: 'note', id: 'n', text: 'a' }, { type: 'note', id: 'n', text: 'b' })).toBeNull();
  });
});

describe('slice 2 — the race resolves FIRST-COME across two real stores (origin ingest)', () => {
  it('Anne (t=10) and Bram (t=12) each claim while partitioned → both stores converge to Anne', async () => {
    const a = newStore();   // Anne's device
    const b = newStore();   // Bram's device
    // What each device produced while partitioned — a confirmed claim with a controlled claim clock. Bram's
    // is causally LATER (would win a naive whole-item LWW); first-come must still keep Anne.
    const claimBundle = (who, t) => ({
      type: 'task', id: 't', text: 't', master: MASTER,
      assignees: [who], assignee: who, claimedAt: t, confirmedAssignee: who, confirmedAt: t, confirmedBy: MASTER,
      claimSeq: 1, updatedAt: t, updatedBy: who,
    });
    await a.put(claimBundle(ANNE, 10), { by: ANNE });    // Anne's local claim
    await b.put(claimBundle(BRAM, 12), { by: BRAM });    // Bram's local claim

    // Cross-ingest each other's claim as an origin (inbound) write — the payloads carry the ORIGIN clock.
    await b.put(claimBundle(ANNE, 10), { origin: true }); // Bram's device receives Anne's earlier claim
    await a.put(claimBundle(BRAM, 12), { origin: true }); // Anne's device receives Bram's later claim

    const onA = await a.get('t');
    const onB = await b.get('t');
    // First-come wins on BOTH devices, despite Bram being causally newer.
    expect(onA.confirmedAssignee).toBe(ANNE);
    expect(onB.confirmedAssignee).toBe(ANNE);
    expect(onA.confirmedAssignee).toBe(onB.confirmedAssignee);   // convergence
  });

  it('EXPLICIT race — both claim pending, the master confirms one; the loser can no longer spawn', async () => {
    const a = newStore();   // Anne's device
    const b = newStore();   // Bram's device
    const pending = (who, t) => ({
      type: 'task', id: 'p', text: 'parent', master: MASTER, claimConfirmation: 'explicit',
      assignees: [who], assignee: who, claimedAt: t, claimSeq: 1, updatedAt: t, updatedBy: who,
    });
    await a.put(pending(ANNE, 10), { by: ANNE });
    await b.put(pending(BRAM, 12), { by: BRAM });
    // Cross-ingest: both pending → first-come (Anne) is the front-runner on both, but neither is confirmed.
    await b.put(pending(ANNE, 10), { origin: true });
    await a.put(pending(BRAM, 12), { origin: true });
    expect(claimState(await a.get('p'))).toBe('pending');
    expect(claimState(await b.get('p'))).toBe('pending');

    // The master confirms Bram explicitly (overriding first-come — an authority may).
    const confirmed = await confirmClaim(a, 'p', { actor: MASTER, assignee: BRAM, rolePolicy: policy });
    // Fan the confirmation to Bram's device (higher sequence supersedes the pending state).
    await b.put({ ...confirmed, updatedAt: 99, updatedBy: MASTER }, { origin: true });
    expect((await b.get('p')).confirmedAssignee).toBe(BRAM);

    // The LOSER (Anne) can no longer spawn; the confirmed claimant (Bram) can.
    await expect(spawnSubtask(a, 'p', { text: 'x' }, { actor: ANNE, rolePolicy: policy }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    const { task } = await spawnSubtask(b, 'p', { text: 'x' }, { actor: BRAM, rolePolicy: policy });
    expect(task.id).toBeTruthy();
  });

  it("a confirmed claimant's subtree survives a concurrent claimLESS edit of the parent", async () => {
    const owner = newStore();     // the confirmed claimant's device
    const editor = newStore();    // a peer editing the parent's TEXT, never having seen the claim
    // Owner: parent confirmed to Anne, with a subtask wired into dependencies.
    await owner.put({
      type: 'task', id: 'p', text: 'parent', master: MASTER,
      assignees: [ANNE], assignee: ANNE, confirmedAssignee: ANNE, confirmedAt: 10, confirmedBy: MASTER,
      claimedAt: 10, claimSeq: 1, dependencies: ['c1'], updatedAt: 10, updatedBy: ANNE,
    }, { origin: true });   // preserve the origin clock (10) so the incoming edit at 20 is genuinely newer
    // The editor's copy predates the claim and carries a NEWER text edit (no claim fields).
    const claimlessNewerEdit = { type: 'task', id: 'p', text: 'renamed parent', master: MASTER, dependencies: ['c1'], updatedAt: 20, updatedBy: BRAM };
    await owner.put(claimlessNewerEdit, { origin: true });

    const merged = await owner.get('p');
    expect(merged.text).toBe('renamed parent');           // content LWW took the newer edit
    expect(merged.confirmedAssignee).toBe(ANNE);          // …but the claim was NOT dropped
    expect(merged.dependencies).toContain('c1');          // …and the subtree gate survives
  });
});
