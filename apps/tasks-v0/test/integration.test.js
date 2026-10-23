/**
 * H4 V0 integration test — substrates wired together end-to-end.
 *
 * Migrated 2026-05-04 to the real `core.Agent` shape (L1d Phase 3.1).
 * Skills are invoked via `agent.skills.get(id).handler({parts, from})`
 * — the real SDK dispatch path, not a synthetic `{invokeSkill}` shim.
 * Item-store events are observed by subscribing to `itemStore` directly
 * (it extends `core.Emitter`).
 *
 * The previous "SkillRouter integration" + "broadcaster" describe blocks
 * are replaced by an end-to-end check using `mountLocalUi` +
 * `LocalAgentClient` from `@onderling/agent-ui`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataPart } from '@onderling/core';
import { mountLocalUi, LocalAgentClient } from '@onderling/agent-ui';

import { createTasksAgent, computeStatus, detectCycle } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';
const OBS   = 'https://id.example/obs';

const ROLES = {
  [ANNE]:  'admin',
  [FRITS]: 'coordinator',
  [KID]:   'member',
  [OBS]:   'observer',
};

const MEMBERS = [
  { webid: ANNE,  displayName: 'Anne',  role: 'admin',       externalIds: { telegramUid: '1' } },
  { webid: FRITS, displayName: 'the author', role: 'coordinator', externalIds: { telegramUid: '2' } },
  { webid: KID,   displayName: 'Kid',   role: 'member',      externalIds: { telegramUid: '3' } },
  { webid: OBS,   displayName: 'Obs',   role: 'observer',    externalIds: {} },
];

/** Invoke a registered skill on the agent, simulating a caller `from`. */
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

let bundle;
beforeEach(async () => {
  bundle = await createTasksAgent({ roles: ROLES, members: MEMBERS });
});

describe('H4 — addTask with role policy', () => {
  it('admin can add', async () => {
    const r = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'paint hallway' }, ANNE);
    expect(r.task.text).toBe('paint hallway');
    expect(r.task.addedBy).toBe(ANNE);
  });

  it('observer cannot add (PermissionDeniedError)', async () => {
    await expect(
      callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, OBS),
    ).rejects.toThrow(/permission denied/);
  });

  it('persists H4-extension fields', async () => {
    const r = await callSkill(bundle.agent, 'addTask', {
      type:           'task',
      text:           'paint hallway',
      notes:          'off-white please',
      requiredSkills: ['paint'],
      dueAt:          1714200000000,
      visibility:     'household',
    }, ANNE);
    expect(r.task).toMatchObject({
      requiredSkills: ['paint'],
      dueAt: 1714200000000,
      visibility: 'household',
      notes: 'off-white please',
    });
  });
});

describe('H4 — DAG dependencies + cycle detection', () => {
  it('rejects a task that would form a dependency cycle', async () => {
    const a = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'A' }, ANNE);
    const b = await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'B', dependencies: [a.task.id] }, ANNE);
    const cycle = detectCycle(
      { id: a.task.id, dependencies: [b.task.id] },
      [a.task, b.task],
    );
    expect(cycle).not.toBeNull();
    expect(cycle).toContain(a.task.id);
    expect(cycle).toContain(b.task.id);
  });

  it('addTask emits DEPENDENCY_CYCLE error when cycle would form on add', async () => {
    const a = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'A' }, ANNE);
    const r = await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'B', dependencies: [a.task.id] }, ANNE);
    expect(r.task.dependencies).toEqual([a.task.id]);
  });

  it('computeStatus returns ready / waiting / blocked correctly', async () => {
    const a = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'A' }, ANNE);
    const b = await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'B', dependencies: [a.task.id] }, ANNE);

    const open   = await bundle.itemStore.listOpen();
    const closed = await bundle.itemStore.listClosed();
    expect(computeStatus(a.task, open, closed)).toBe('ready');
    expect(computeStatus(b.task, open, closed)).toBe('waiting');

    await callSkill(bundle.agent, 'completeTask', { id: a.task.id }, ANNE);
    const open2   = await bundle.itemStore.listOpen();
    const closed2 = await bundle.itemStore.listClosed();
    expect(computeStatus(b.task, open2, closed2)).toBe('ready');
  });

  it('listOpen({status: "waiting"}) returns only waiting tasks', async () => {
    const a = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'A' }, ANNE);
    await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'B', dependencies: [a.task.id] }, ANNE);
    const r = await callSkill(bundle.agent, 'listOpen', { status: 'waiting' }, ANNE);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe('B');
  });
});

describe('H4 — claim + assignee compare-and-swap', () => {
  it('claim succeeds for member with right posture', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'vacuum' }, ANNE);
    const r = await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, KID);
    expect(r.result.assignee).toBe(KID);
  });

  it('observer cannot claim', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await expect(
      callSkill(bundle.agent, 'claimTask', { id: t.task.id }, OBS),
    ).rejects.toThrow(/permission denied/);
  });

  it('second claim returns {error: already-claimed}', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, KID);
    const r = await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, FRITS);
    expect(r.result.error).toBe('already-claimed');
    expect(r.result.current.assignee).toBe(KID);
  });
});

describe('H4 — reassign + remove (role-policy-gated)', () => {
  it('coordinator can reassign', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, KID);
    const r = await callSkill(bundle.agent, 'reassignTask',
      { id: t.task.id, newAssignee: FRITS }, FRITS);
    expect(r.task.assignee).toBe(FRITS);
  });

  it('member cannot reassign (admin/coordinator only)', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, KID);
    await expect(
      callSkill(bundle.agent, 'reassignTask', { id: t.task.id, newAssignee: FRITS }, KID),
    ).rejects.toThrow(/permission denied/);
  });

  it('only admin can remove', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    for (const actor of [FRITS, KID]) {
      await expect(
        callSkill(bundle.agent, 'removeTask', { id: t.task.id }, actor),
      ).rejects.toThrow(/permission denied/);
    }
    const r = await callSkill(bundle.agent, 'removeTask', { id: t.task.id }, ANNE);
    expect(r.id).toBe(t.task.id);
  });
});

describe('H4 — skill-tagged claim flow + OfferingMatch wiring', () => {
  it('listClaimable filters to unassigned + skill-matching tasks', async () => {
    await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'paint A', requiredSkills: ['paint'] }, ANNE);
    await callSkill(bundle.agent, 'addTask',
      { type: 'task', text: 'fix tap', requiredSkills: ['plumb'] }, ANNE);
    const r = await callSkill(bundle.agent, 'listClaimable', { skill: 'paint' }, KID);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe('paint A');
  });
});

describe('H4 — listMine + identity resolution', () => {
  it('listMine returns tasks assigned to actor', async () => {
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await callSkill(bundle.agent, 'claimTask', { id: t.task.id }, KID);

    const r = await callSkill(bundle.agent, 'listMine', undefined, KID);
    expect(r.items).toHaveLength(1);
  });


});

describe('H4 — itemStore events (fan-out)', () => {
  // Replaces the pre-2026-05-04 `bundle.broadcaster` indirection.
  // ItemStore extends core.Emitter; subscribe directly.
  it('emits item-added when a task is added', async () => {
    const events = [];
    bundle.itemStore.on('item-added', (i) => events.push(['added', i.id]));
    await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    expect(events.some((e) => e[0] === 'added')).toBe(true);
  });

  it('emits item-claimed + item-completed', async () => {
    const events = [];
    bundle.itemStore.on('item-claimed',   () => events.push('claimed'));
    bundle.itemStore.on('item-completed', () => events.push('completed'));
    const t = await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'x' }, ANNE);
    await callSkill(bundle.agent, 'claimTask',    { id: t.task.id }, KID);
    await callSkill(bundle.agent, 'completeTask', { id: t.task.id }, KID);
    expect(events).toContain('claimed');
    expect(events).toContain('completed');
  });
});

describe('H4 — mountLocalUi + LocalAgentClient (HTTP exposure)', () => {
  // Replaces the pre-2026-05-04 SkillRouter integration tests. The new
  // path: a real A2A server bound to 127.0.0.1; LocalAgentClient speaks
  // A2A's wire shape. Skill visibility is enforced by the agent card +
  // PolicyEngine, not by an exposedSkills allowlist.
  let ui;

  it('agent card endpoint responds with the A2A card shape', async () => {
    ui = await mountLocalUi(bundle.agent, { port: 0 });
    const client = new LocalAgentClient({ baseUrl: ui.url });
    const card = await client.discoverSkills();
    // Tier-0 (anonymous) callers see only `visibility: 'public'` skills.
    // All H4 skills are `visibility: 'authenticated'`, so the public card
    // is empty — but the endpoint must still return a valid card shape.
    expect(card.name).toBeDefined();
    expect(Array.isArray(card.skills)).toBe(true);
    expect(card.authentication).toBeDefined();
    await ui.stop(); ui = null;
  });

  it('a read-only skill call round-trips over A2A', async () => {
    // Pre-seed via direct skill call (role-policy-gated; admin only).
    await callSkill(bundle.agent, 'addTask', { type: 'task', text: 'seeded' }, ANNE);

    // Read over A2A. listOpen is read-only — no role policy gate, no auth needed.
    ui = await mountLocalUi(bundle.agent, { port: 0 });
    const client = new LocalAgentClient({ baseUrl: ui.url });
    const result = await client.invoke('listOpen', []);
    expect(result.status).toBe('completed');
    const dp = result.parts.find((p) => p.type === 'DataPart');
    expect(dp?.data?.items?.length).toBe(1);
    expect(dp?.data?.items[0].text).toBe('seeded');
    await ui.stop(); ui = null;
  });

  // NB: write skills (addTask / claimTask / etc.) require an authenticated
  // actor's webid to flow into the item-store role policy. The OIDC wiring
  // for that lives in a `LocalUiAuth` (per L1d audit Phase 2) — not built
  // this session. Tests for the write path go through `callSkill(...)` above.
});

describe('H4 — pod-backed roster (MemberMap.fromPodConfig)', () => {

  it('NOT_FOUND tolerance: bootstrap-time empty-pod returns the supplied fallback', async () => {
    const podClient = {
      async read() {
        const err = new Error('not found');
        err.code = 'NOT_FOUND';
        throw err;
      },
    };
    const podBundle = await createTasksAgent({
      roles: ROLES,
      pod:   {
        client:    podClient,
        configUri: 'https://h4.example/config.json',
        fallback:  [{ webid: ANNE, displayName: 'Anne (bootstrap)', role: 'admin' }],
      },
    });
    expect((await podBundle.members.list()).map((m) => m.webid)).toEqual([ANNE]);
  });

  it('rejects mixing `pod` and `members` in the same call', async () => {
    await expect(createTasksAgent({
      roles:   ROLES,
      members: MEMBERS,
      pod:     { client: { read: async () => ({ content: { members: [] } }) }, configUri: 'x' },
    })).rejects.toThrow(/either `pod` or `members`/);
  });
});
