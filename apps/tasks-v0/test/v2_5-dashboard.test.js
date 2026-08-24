/**
 * cross-circle dashboard.
 */

import { describe, it, expect } from 'vitest';

import { aggregateCircles } from '../src/dashboard/aggregator.js';
import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE = 'https://id.example/anne';
const KID  = 'https://id.example/kid';

const CIRCLE_A = {
  circleId: 'circle-a', name: 'Circle A', kind: 'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: KID,  displayName: 'Kid',  role: 'member' },
  ],
};
const CIRCLE_B = {
  circleId: 'circle-b', name: 'Circle B', kind: 'household',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    // KID is NOT in circle B.
  ],
};

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

describe('V2.5 — aggregateCircles (pure)', () => {
  it('correct counters per circle', () => {
    const now = 1_000_000;
    const r = aggregateCircles({
      circles: [
        {
          circle: { circleId: 'a', name: 'A', kind: 'project' },
          openTasks: [
            { id: '1', dueAt: now - 1000, assignee: ANNE },                // overdue + mine
            { id: '2', assignee: KID, reviewLog: [{ decision: 'submit' }] }, // submitted
            { id: '3', type: 'inbox-item', kind: 'subtask-request' },                           // ignored
          ],
        },
      ],
      actor: ANNE,
      now,
      roleOf: () => 'admin',
    });
    expect(r).toHaveLength(1);
    expect(r[0].counts).toEqual({ open: 2, overdue: 1, awaitingApproval: 1, mine: 1 });
  });

  it('sorts busiest first', () => {
    const r = aggregateCircles({
      circles: [
        { circle: { circleId: 'a', name: 'A' }, openTasks: [{ id: '1' }] },
        { circle: { circleId: 'b', name: 'B' }, openTasks: [{ id: '1' }, { id: '2' }, { id: '3' }] },
        { circle: { circleId: 'c', name: 'C' }, openTasks: [{ id: '1' }, { id: '2' }] },
      ],
      actor: ANNE,
    });
    expect(r.map((c) => c.circleId)).toEqual(['b', 'c', 'a']);
  });
});

describe('V2.5 — getMyCircles skill', () => {
  it('returns one row for the only circle (single-circle launcher)', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig: CIRCLE_A, localStoreBundle: bundle, wireOnboardingSkills: false,
    });
    await call(circle, 'addTask', { text: 'A1' }, ANNE);
    const r = await call(circle, 'getMyCircles', {}, ANNE);
    expect(r.circles).toHaveLength(1);
    expect(r.circles[0].circleId).toBe('circle-a');
    expect(r.circles[0].counts.open).toBe(1);
    await circle.close();
  });

  it('hides circles the actor is not a member of', async () => {
    // Build two circles on a shared store + share the bundle list via
    // circleBundlesProvider.
    const bundleA = buildBundle();
    const circleA = await createCircleAgent({
      circleConfig: CIRCLE_A, localStoreBundle: bundleA, wireOnboardingSkills: false,
    });
    const bundleB = buildBundle();
    let circleB;
    const provider = () => {
      const list = [
        { circle: circleA.getCircle(), itemStore: circleA.itemStore, roleOf: (a) => CIRCLE_A.members.find((m) => m.webid === a)?.role },
      ];
      if (circleB) list.push({ circle: circleB.getCircle(), itemStore: circleB.itemStore, roleOf: (a) => CIRCLE_B.members.find((m) => m.webid === a)?.role });
      return list;
    };
    circleB = await createCircleAgent({
      circleConfig: CIRCLE_B, localStoreBundle: bundleB, wireOnboardingSkills: false,
      circleBundlesProvider: provider,
    });

    // KID is only in CIRCLE_A; the dashboard skill on circleB should
    // still hide CIRCLE_B from KID.
    const r = await call(circleB, 'getMyCircles', {}, KID);
    expect(r.circles.map((c) => c.circleId)).toEqual(['circle-a']);
    await circleA.close();
    await circleB.close();
  });
});

describe('J3 — listMyTasksAcrossCircles skill', () => {
  it('returns my tasks flat across circles, excludes unassigned, tags each row with circleId', async () => {
    // Two circles on separate stores, shared via circleBundlesProvider —
    // same wiring the getMyCircles multi-circle test uses.
    const bundleA = buildBundle();
    const circleA = await createCircleAgent({
      circleConfig: CIRCLE_A, localStoreBundle: bundleA, wireOnboardingSkills: false,
    });
    const bundleB = buildBundle();
    let circleB;
    const provider = () => {
      const list = [
        { circle: circleA.getCircle(), itemStore: circleA.itemStore, roleOf: (a) => CIRCLE_A.members.find((m) => m.webid === a)?.role },
      ];
      if (circleB) list.push({ circle: circleB.getCircle(), itemStore: circleB.itemStore, roleOf: (a) => CIRCLE_B.members.find((m) => m.webid === a)?.role });
      return list;
    };
    circleB = await createCircleAgent({
      circleConfig: CIRCLE_B, localStoreBundle: bundleB, wireOnboardingSkills: false,
      circleBundlesProvider: provider,
    });

    // Seed: a task assigned to ANNE in C1, a task assigned to ANNE in C2,
    // and an UNASSIGNED task in C1 (must be excluded).
    const a1 = await call(circleA, 'addTask', { text: 'A-mine' }, ANNE);
    await call(circleA, 'claimTask', { id: a1.task.id }, ANNE);
    await call(circleA, 'addTask', { text: 'A-unassigned' }, ANNE);   // stays open + unclaimed
    const b1 = await call(circleB, 'addTask', { text: 'B-mine' }, ANNE);
    await call(circleB, 'claimTask', { id: b1.task.id }, ANNE);

    const r = await call(circleB, 'listMyTasksAcrossCircles', {}, ANNE);
    const texts = r.items.map((t) => t.text).sort();
    expect(texts).toEqual(['A-mine', 'B-mine']);        // both mine, unassigned excluded

    // Each row carries the owning circleId (+ circleName) for deep-linking.
    const byCircle = Object.fromEntries(r.items.map((t) => [t.circleId, t.text]));
    expect(byCircle['circle-a']).toBe('A-mine');
    expect(byCircle['circle-b']).toBe('B-mine');
    for (const t of r.items) {
      expect(typeof t.circleId).toBe('string');
      expect(t.circleName).toBeTruthy();
    }

    await circleA.close();
    await circleB.close();
  });
});

describe('V2.5 — bot.circles', () => {
  it('dispatcher routes "circles"', () => {
    expect(dispatch('circles')).toEqual({ kind: 'skill', skillId: 'bot.circles', args: {} });
    expect(dispatch('my circles')).toEqual({ kind: 'skill', skillId: 'bot.circles', args: {} });
  });

  it('bot.circles returns one line per circle', async () => {
    const bundle = buildBundle();
    const circle = await createCircleAgent({
      circleConfig: CIRCLE_A, localStoreBundle: bundle, wireOnboardingSkills: false,
    });
    await call(circle, 'addTask', { text: 'A1' }, ANNE);
    const def = circle.agent.skills.get('bot.circles');
    const reply = await def.handler({ parts: [], from: ANNE, agent: circle.agent, envelope: null });
    expect(reply.text).toContain('Circle A');
    expect(reply.text).toMatch(/1 open/);
    await circle.close();
  });
});
