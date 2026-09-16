/**
 * dashboard — Tasks cross-circle dashboard.
 *
 *   - `getMyCircles()` — self only. Returns one row per circle the actor
 *     belongs to (across every CircleState the meshAgent knows about),
 *     each with `{circleId, name, kind, counts: {open, overdue,
 *     awaitingApproval, mine}}`.
 *   - `listMyTasksAcrossCircles()` — self only. J3. Same circle
 *     enumeration as `getMyCircles`, but instead of per-circle COUNTS
 *     it returns a FLAT array of the actual open task ITEMS where the
 *     calling actor is a co-owner (`assigneesOf(t).includes(from)`),
 *     each row tagged with its `circleId` (+ `circleName`) so the
 *     self-chat / central-agent view can deep-link. Open + assigned-to-me
 *     only; unassigned tasks are excluded.
 *
 * After: registered ONCE on the meshAgent. The skill enumerates
 * circles via `circlesProvider()` (returns `Map<circleId, CircleState>` or
 * any iterable of CircleStates) and filters to circles where the actor
 * has a role.
 */

import { defineSkill } from '@onderling/core';
import { assigneesOf } from '@onderling/item-store';

import { aggregateCircles } from '../dashboard/aggregator.js';
import { makeRoleOf } from './roleOf.js';

/**
 * Shared circle enumeration for the dashboard skills. Resolves the
 * calling circle context, honours the per-CircleState multi-circle
 * override provider (`_dashboardCirclesProvider`), and filters to the
 * circles where `from` holds a role. Returns `{ ctxCircle, eligible }`
 * or `{ error }` — identical to the (previously inline) getMyCircles gate.
 */
async function eligibleCirclesFor({ parts, from, envelope, bundleResolver, circlesProvider, roleOf }) {
  const ctxCircle = bundleResolver(parts, { envelope, from });
  if (!ctxCircle) return { error: 'circleId required' };
  if (typeof from !== 'string' || !from) return { error: 'webid required' };
  // multi-circle launches plumb a per-CircleState override provider
  // (`_dashboardCirclesProvider`) so the dashboard sees every circle the
  // launcher built — even those not in the local wireSkills's
  // `circlesProvider`. Falls back to the wireSkills default for
  // single-circle launches.
  const cp = typeof ctxCircle._dashboardCirclesProvider === 'function'
    ? ctxCircle._dashboardCirclesProvider
    : circlesProvider;
  const allCircles = [...(cp() ?? [])];
  // A circle counts for this caller when the head (or the declared map) gives them a role in it.
  const eligible = [];
  const roleIn = new Map();   // circleId → the caller's role, read once per circle
  for (const cs of allCircles) {
    const role = await roleOf(cs, from);
    if (typeof role === 'string' && role.length > 0) { eligible.push(cs); roleIn.set(cs?.liveCircle?.circleId ?? cs?.circleId, role); }
  }
  return { ctxCircle, eligible, roleIn };
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolves the *calling* circle context. The skill body uses the
 *   caller's webid to filter `circlesProvider()` independently — so
 *   a single-circle launch still works (both bundleResolver and
 *   circlesProvider return the same one circle).
 * @param {() => Iterable<object>} args.circlesProvider
 *   Returns every CircleState the meshAgent knows about. Each
 *   CircleState exposes `.liveCircle` + `.itemStore` + `.roles` so the
 *   aggregator can compute counts.
 */
export function buildDashboardSkills({ bundleResolver, circlesProvider, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildDashboardSkills: bundleResolver(parts, ctx) required');
  }
  if (typeof circlesProvider !== 'function') {
    throw new TypeError('buildDashboardSkills: circlesProvider() required');
  }

  return [
    defineSkill('getMyCircles', async ({ parts, from, envelope }) => {
      const gate = await eligibleCirclesFor({ parts, from, envelope, bundleResolver, circlesProvider, roleOf });
      if (gate.error) return { error: gate.error };
      const { eligible, roleIn } = gate;

      const inputs = [];
      for (const cs of eligible) {
        let openTasks = [];
        try { openTasks = await cs.itemStore.listOpen(); } catch { /* skip */ }
        inputs.push({ circle: cs.liveCircle, openTasks });
      }
      const circles = aggregateCircles({
        circles: inputs,
        actor: from,
        // The aggregator asks for the CALLER's role per circle — read above, from the same source.
        roleOf: (_actor, circle) => roleIn.get(circle?.circleId),
      });
      return { circles };
    }, {
      description: 'List every circle the calling actor belongs to with counts.',
      visibility:  'authenticated',
    }),

    /**
     * listMyTasksAcrossCircles() — J3. The flat cross-circle "all my
     * tasks" list. Same circle enumeration + membership gate as
     * getMyCircles, but returns the actual OPEN task ITEMS where `from`
     * is a co-owner (`assigneesOf(t).includes(from)`) rather than
     * per-circle counts. Unassigned tasks are excluded (they'd fail the
     * membership filter). Each row is the task item spread + `circleId`
     * and `circleName` so the self-chat / central-agent view can
     * deep-link back to the owning circle. Open-only (closed/completed
     * tasks are not surfaced — this is the actionable to-do list).
     */
    defineSkill('listMyTasksAcrossCircles', async ({ parts, from, envelope }) => {
      const gate = await eligibleCirclesFor({ parts, from, envelope, bundleResolver, circlesProvider, roleOf });
      if (gate.error) return { error: gate.error };
      const { eligible } = gate;

      const items = [];
      for (const cs of eligible) {
        let openTasks = [];
        try { openTasks = await cs.itemStore.listOpen(); } catch { /* skip circle on read error */ }
        const circleId   = cs.liveCircle?.circleId;
        const circleName = cs.liveCircle?.name ?? circleId;
        for (const t of openTasks) {
          if (!assigneesOf(t).includes(from)) continue;   // co-owner membership (mirror-compatible)
          items.push({ ...t, circleId, circleName });
        }
      }
      return { items };
    }, {
      description: 'List every open task assigned to the calling actor across all their circles (flat, tagged with circleId).',
      visibility:  'authenticated',
    }),
  ];
}
