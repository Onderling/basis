/**
 * Phase 7 — sub-tasks + DAG tree + admin-approval queue.
 *
 * Covers:
 *   1. dag-tree pure helpers: childrenOf / treeOf / ancestorChain /
 *      depthOf / wouldCreateParentCycle.
 *   2. addSubtask basic spawn — parent's assignee creates a child;
 *      child carries parentTaskId; spawner becomes master; parent's
 *      dependencies gain the child id.
 *   3. addSubtask authz — random member rejected; parent's master,
 *      assignee, admin, coordinator allowed.
 *   4. addSubtask depth threshold — depth > circle.subtasksAdminApprovalDepth
 *      queues a `subtask-request` instead of creating directly.
 *   5. approveSubtaskRequest — admin approves; sub-task is created
 *      under the original requester; request marked complete.
 *   6. declineSubtaskRequest — admin declines; no sub-task created;
 *      request marked complete with the decline note.
 *   7. Admin notification — subtask-request → all admins/coords get
 *      an inbox entry with approve/decline buttons.
 *   8. Cycle: spawning a sub-task that would close a parent-chain
 *      cycle is rejected.
 *   9. Status integration: a parent with sub-tasks correctly reports
 *      `waiting` until all sub-tasks complete (via dependencies).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart } from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import {
  childrenOf, treeOf, ancestorChain, depthOf, wouldCreateParentCycle,
} from '../src/dag-tree.js';
import { computeStatus } from '../src/dag.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE_BASE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function listInbox(cache, container = 'mem://user/inbox/') {
  const keys = await cache.list(container);
  const out = [];
  for (const k of keys) {
    const raw = await cache.read(k);
    if (!raw) continue;
    out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out.sort((a, b) => a.addedAt - b.addedAt);
}

// ── Pure dag-tree helper tests ─────────────────────────────────────────────

describe('Phase 7 — dag-tree helpers (pure)', () => {
  const tasks = [
    { id: 'A', text: 'root' },
    { id: 'B', text: 'child of A',     containedBy: ['A'] },
    { id: 'C', text: 'child of B',     containedBy: ['B'] },
    { id: 'D', text: 'sibling of C',   containedBy: ['B'] },
    { id: 'E', text: 'orphan' },
  ];

  it('childrenOf returns direct children only', () => {
    const ch = childrenOf('B', tasks);
    expect(ch.map((t) => t.id).sort()).toEqual(['C', 'D']);
    expect(childrenOf('E', tasks)).toEqual([]);
  });

  it('treeOf returns the recursive sub-tree', () => {
    const tree = treeOf('A', tasks);
    expect(tree.id).toBe('A');
    expect(tree.children).toHaveLength(1);                 // B
    expect(tree.children[0].id).toBe('B');
    expect(tree.children[0].children.map((c) => c.id).sort()).toEqual(['C', 'D']);
  });

  it('ancestorChain walks the containment chain upward to the root', () => {
    expect(ancestorChain('C', tasks).map((t) => t.id)).toEqual(['A', 'B', 'C']);
    expect(ancestorChain('A', tasks).map((t) => t.id)).toEqual(['A']);
    expect(ancestorChain('E', tasks).map((t) => t.id)).toEqual(['E']);
    expect(ancestorChain('NONEXISTENT', tasks)).toEqual([]);
  });

  it('depthOf counts ancestors', () => {
    expect(depthOf('A', tasks)).toBe(0);
    expect(depthOf('B', tasks)).toBe(1);
    expect(depthOf('C', tasks)).toBe(2);
    expect(depthOf('E', tasks)).toBe(0);
  });

  it('wouldCreateParentCycle catches direct + transitive cycles', () => {
    // making A a sub-task of C would put C → ... → A → C
    expect(wouldCreateParentCycle('C', 'A', tasks)).toEqual(['A', 'B', 'C', 'A']);
    // a fresh sub-task under A is fine
    expect(wouldCreateParentCycle('A', '__new__', tasks)).toBeNull();
    // self-cycle
    expect(wouldCreateParentCycle('A', 'A', tasks)).toEqual(['A', 'A']);
  });
});

// ── Live skill tests via createCircleAgent ──────────────────────────────────

describe('Phase 7 — addSubtask (live, with depth threshold)', () => {
  let lsBundle;
  let circle;

  async function freshCircle(circleConfig = CIRCLE_BASE) {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  }

  afterEach(async () => {
    await circle?.close?.();
  });

  it('basic spawn: the CONFIRMED claimant creates a sub-task; child carries the containment edge; parent gains the dep edge', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask', { text: 'Build shed' }, ANNE);
    // claimTask on a default (auto-confirm) task confirms the claim, so the claimant may decompose.
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);

    const r = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id,
      text:         'Order planks',
    }, KID);
    expect(r.queued).toBe(false);
    expect(r.task).toBeDefined();
    expect(r.task.containedBy).toContain(parent.id);   // the containment edge (was parentTaskId)
    expect(r.task.master).toBe(KID);     // spawner is master of the child
    expect(r.depth).toBe(1);

    const updatedParent = await circle.itemStore.getById(parent.id);
    expect(updatedParent.dependencies).toContain(r.task.id);
  });

  it('EXPLICIT mode: a pending claimant spawns PROVISIONALLY; confirmation commits + unlocks committed spawns', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Paint fence', claimConfirmation: 'explicit' }, ANNE);
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);   // pending (explicit)

    // Pending claimant may spawn OPTIMISTICALLY — a provisional child ("not yours yet"), not a committed one.
    const prov = await callSkill(circle.agent, 'addSubtask', { parentTaskId: parent.id, text: 'Buy paint' }, KID);
    expect(prov.provisional).toBe(true);
    expect(prov.task.provisional).toBe(true);
    const parentBefore = await circle.itemStore.getById(parent.id);
    expect(parentBefore.dependencies ?? []).not.toContain(prov.task.id);   // provisional ⇒ no gate

    // The authority (Anne, admin) confirms Kid's claim → the provisional subtree becomes real.
    const confirmed = await callSkill(circle.agent, 'confirmClaim', { id: parent.id }, ANNE);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.task.confirmedAssignee).toBe(KID);
    const committedKid = await circle.itemStore.getById(prov.task.id);
    expect(committedKid.provisional).toBe(false);
    const parentAfter = await circle.itemStore.getById(parent.id);
    expect(parentAfter.dependencies).toContain(prov.task.id);              // now gates

    // And a confirmed claimant now spawns COMMITTED subtasks directly.
    const ok = await callSkill(circle.agent, 'addSubtask', { parentTaskId: parent.id, text: 'Sand it' }, KID);
    expect(ok.provisional).toBeFalsy();
    expect(ok.task.containedBy).toContain(parent.id);
  });

  it('the pending-claims approvals list surfaces a master\'s unconfirmed claims, and clears on confirmation', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Hang shelves', claimConfirmation: 'explicit' }, ANNE);   // Anne masters it
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);  // pending

    // Anne (the master) sees the pending claim in her approvals list, tagged pending-confirmation.
    const before = await callSkill(circle.agent, 'listMyPendingClaims', {}, ANNE);
    const row = (before.items ?? []).find((t) => t.id === parent.id);
    expect(row, 'the pending claim is in Anne\'s approvals list').toBeTruthy();
    expect(row.status).toBe('pending-confirmation');

    // A non-master (Kid) sees nothing to confirm.
    const kidList = await callSkill(circle.agent, 'listMyPendingClaims', {}, KID);
    expect((kidList.items ?? []).some((t) => t.id === parent.id)).toBe(false);

    // After Anne confirms, it leaves the list.
    await callSkill(circle.agent, 'confirmClaim', { id: parent.id }, ANNE);
    const after = await callSkill(circle.agent, 'listMyPendingClaims', {}, ANNE);
    expect((after.items ?? []).some((t) => t.id === parent.id)).toBe(false);
  });

  it('master can spawn even when not the assignee', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Build shed' }, FRITS);   // master = the author
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);

    const r = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id,
      text:         'Source materials',
    }, FRITS);
    expect(r.queued).toBe(false);
    expect(r.task).toBeDefined();
    expect(r.task.master).toBe(FRITS);
  });

  it('admin can spawn under someone else\'s parent task', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Build shed' }, FRITS);
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);
    const r = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id, text: 'Admin nudge',
    }, ANNE);
    expect(r.queued).toBe(false);
    expect(r.task.master).toBe(ANNE);
  });

  it('rejects callers who are neither assignee, master, admin, nor coordinator', async () => {
    await freshCircle();
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Build shed' }, ANNE);
    // Kid is NOT the assignee, NOT the master, just a member.
    const r = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id, text: 'Sneaky',
    }, KID);
    expect(r.error).toMatch(/assignee|master|admin/i);
  });

  it('rejects an unknown parentTaskId', async () => {
    await freshCircle();
    const r = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: '01XYZ', text: 'orphan',
    }, ANNE);
    expect(r.error).toMatch(/parent task not found/i);
  });

  it('depth > circle.subtasksAdminApprovalDepth queues an admin-approval request', async () => {
    // Use threshold 1 so going past it is easy: parent (depth 0) →
    // child (depth 1, allowed) → grandchild (depth 2, queued).
    await freshCircle({ ...CIRCLE_BASE, subtasksAdminApprovalDepth: 1 });

    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Root' }, ANNE);
    const r1 = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id, text: 'Child',
    }, ANNE);
    expect(r1.queued).toBe(false);

    // Grandchild — depth 2 > threshold 1 → queued.
    const r2 = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: r1.task.id, text: 'Grandchild',
    }, ANNE);
    expect(r2.queued).toBe(true);
    expect(r2.requestId).toBeTruthy();
    expect(r2.newDepth).toBe(2);
    expect(r2.threshold).toBe(1);

    // The actual sub-task does NOT exist yet — only the request item.
    const open = await circle.itemStore.listOpen();
    const grandchildren = open.filter((i) => i.parentTaskId === r1.task.id);
    expect(grandchildren).toHaveLength(0);
    const requests = open.filter((i) => i.type === 'subtask-request');
    expect(requests).toHaveLength(1);
  });
});

// ── Approve / decline + admin notifications ───────────────────────────────

describe('Phase 7 — approve / decline subtask requests', () => {
  let lsBundle;
  let circle;

  beforeEach(async () => {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig:           { ...CIRCLE_BASE, subtasksAdminApprovalDepth: 1 },
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    await circle?.close?.();
  });

  async function spawnQueued() {
    const { task: parent } = await callSkill(circle.agent, 'addTask',
      { text: 'Root' }, ANNE);
    const r1 = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id, text: 'Child',
    }, ANNE);
    const r2 = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: r1.task.id, text: 'Grandchild',
    }, ANNE);
    return { parent, child: r1.task, requestId: r2.requestId };
  }

  it('approveSubtaskRequest: admin approves → sub-task is created, request closed', async () => {
    const { child, requestId } = await spawnQueued();

    const r = await callSkill(circle.agent, 'approveSubtaskRequest',
      { requestId }, ANNE);
    expect(r.ok).toBe(true);
    expect(r.task).toBeDefined();
    expect(r.task.containedBy).toContain(child.id);   // containment edge (was parentTaskId)

    // Request is closed.
    const reqAfter = await circle.itemStore.getById(requestId);
    expect(reqAfter.completedAt).toBeGreaterThan(0);

    // Parent's dependencies gained the new sub-task id.
    const childAfter = await circle.itemStore.getById(child.id);
    expect(childAfter.dependencies).toContain(r.task.id);
  });

  it('declineSubtaskRequest: admin declines → no sub-task created; request closed with note', async () => {
    const { child, requestId } = await spawnQueued();

    const r = await callSkill(circle.agent, 'declineSubtaskRequest', {
      requestId,
      note:      'Out of scope',
    }, ANNE);
    expect(r.ok).toBe(true);

    const reqAfter = await circle.itemStore.getById(requestId);
    expect(reqAfter.completedAt).toBeGreaterThan(0);
    expect(reqAfter.notes).toMatch(/Out of scope/);

    // No sub-task under `child`.
    const open = await circle.itemStore.listOpen();
    const grand = open.filter((i) => i.parentTaskId === child.id);
    expect(grand).toHaveLength(0);
  });

  it('non-admin cannot approve / decline', async () => {
    const { requestId } = await spawnQueued();
    const a = await callSkill(circle.agent, 'approveSubtaskRequest', { requestId }, KID);
    expect(a.error).toMatch(/admin|coordinator/i);
    const d = await callSkill(circle.agent, 'declineSubtaskRequest', { requestId }, KID);
    expect(d.error).toMatch(/admin|coordinator/i);
  });

  it('admins receive an inbox entry on subtask-request creation', async () => {
    await spawnQueued();
    await new Promise((r) => setTimeout(r, 30));

    const inbox = await listInbox(lsBundle.cache);
    const requestEntries = inbox.filter((e) => e.source?.meta?.eventType === 'subtask-request');
    // Anne (admin) AND the author (coordinator) both should have received one.
    expect(requestEntries.length).toBeGreaterThanOrEqual(2);
    for (const e of requestEntries) {
      expect(e.source.buttons?.[0]?.id).toMatch(/^approveSubtaskRequest:/);
      expect(e.source.buttons?.[1]?.id).toMatch(/^declineSubtaskRequest:/);
    }
  });
});

// ── Status integration ────────────────────────────────────────────────────

describe('Phase 7 — sub-task status feeds back into computeStatus', () => {
  let lsBundle;
  let circle;

  beforeEach(async () => {
    lsBundle = buildBundle();
    circle = await createCircleAgent({
      circleConfig:           CIRCLE_BASE,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    await circle?.close?.();
  });

  it('parent with one open sub-task is "waiting"; flips to "ready" when the sub-task completes', async () => {
    const { task: parent } = await callSkill(circle.agent, 'addTask', { text: 'Root' }, ANNE);
    await callSkill(circle.agent, 'claimTask', { id: parent.id }, KID);
    const sub = await callSkill(circle.agent, 'addSubtask', {
      parentTaskId: parent.id, text: 'Child',
    }, KID);

    // Parent now has the child as a dependency → 'waiting'.
    const open1 = await circle.itemStore.listOpen();
    const closed1 = await circle.itemStore.listClosed();
    expect(computeStatus(open1.find((t) => t.id === parent.id), open1, closed1)).toBe('waiting');

    // Complete the sub-task.
    await callSkill(circle.agent, 'claimTask', { id: sub.task.id }, KID);
    await callSkill(circle.agent, 'completeTask', { id: sub.task.id }, KID);

    // Parent flips to 'ready' (no remaining open dependencies).
    const open2 = await circle.itemStore.listOpen();
    const closed2 = await circle.itemStore.listClosed();
    expect(computeStatus(open2.find((t) => t.id === parent.id), open2, closed2)).toBe('ready');
  });
});
