/**
 * observability skills — Tasks V1 Phase 9.
 *
 * Skills:
 *   - `getMetrics()` — read-only snapshot of the local MetricsTracker.
 *     V1 keeps the snapshot strictly local (no auto-share); the UI
 *     surfaces it on the circle settings tab. Future V2 work adds an
 *     opt-in pod-mirror so admins can aggregate across members.
 *   - `getCircleCadences()` — current per-event cadence map for the circle.
 *   - `setCircleCadences({cadences})` — admin/coord only; mutates the
 *     live circle config.
 *   - `getMyCadenceOverrides()` — the user's overrides from Settings.
 *   - `setMyCadenceOverrides({overrides})` — write the user's overrides.
 *   - `resolveMyCadence({eventType})` — convenience: returns the
 *     effective `{channel, suppressed, leadMs}` for the caller given
 *     all three layers.
 *
 * The metrics tracker is per-CircleState (`circle.metricsTracker`) since
 * each ItemStore has its own tracker. `userSettings` is process-level
 * (per-device, not per-circle) and is passed as a separate dep to the
 * builder.
 */

import { defineSkill } from '@onderling/core';

import { resolveCadence, sanitiseCadenceMap } from '../observability/cadence.js';
import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

/**
 * Build the observability skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   CircleState exposes `metricsTracker` + `userSettings` (the latter is
 *   process-level but read off the CircleState so wireSkills doesn't
 *   need to know about per-process bindings — createCircleAgent installs
 *   `circleState.userSettings` post-construction).
 * @param {{loadShared, updateShared}} [args.userSettings]
 *   Fallback used only if `circle.userSettings` is missing — typically
 *   the no-op default supplied by wireSkills on the V0 path.
 */
export function buildObservabilitySkills({ bundleResolver, userSettings: fallbackUserSettings, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildObservabilitySkills: bundleResolver(parts, ctx) required');
  }
  const fallback = fallbackUserSettings ?? {
    loadShared:   async () => ({}),
    updateShared: async () => ({}),
  };
  function settingsOf(circle) {
    return circle.userSettings ?? fallback;
  }

  return [
    defineSkill('getMetrics', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const tracker = circle.metricsTracker;
      if (!tracker?.snapshot) return { error: 'metricsTracker not wired for this circle' };
      return { snapshot: tracker.snapshot() };
    }, {
      description: 'Read the local MetricsTracker snapshot (counters + latency p50/p90).',
    }),

    defineSkill('getCircleCadences', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const lc = circle.liveCircle ?? {};
      return { cadences: { ...(lc.cadences ?? {}) } };
    }, {
      description: 'Read the circle\'s per-event cadence config.',
    }),

    defineSkill('setCircleCadences', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const a = argsFromParts(parts);
      const sanitised = sanitiseCadenceMap(a.cadences ?? {});
      circle.circleMutator({ cadences: sanitised });
      const lc = circle.liveCircle ?? {};
      return { cadences: { ...(lc.cadences ?? {}) } };
    }, {
      description: 'Set the circle-wide cadence config (admin/coord only).',
    }),

    defineSkill('getMyCadenceOverrides', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const settings = await settingsOf(circle).loadShared();
      return { overrides: { ...(settings.cadenceOverrides ?? {}) } };
    }, {
      description: 'Read my user-side cadence overrides.',
    }),

    defineSkill('setMyCadenceOverrides', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const sanitised = sanitiseCadenceMap(a.overrides ?? {});
      await settingsOf(circle).updateShared({ cadenceOverrides: sanitised });
      return { overrides: sanitised };
    }, {
      description: 'Set my user-side cadence overrides.',
    }),

    defineSkill('resolveMyCadence', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.eventType !== 'string' || !a.eventType) {
        return { error: 'eventType required' };
      }
      const lc = circle.liveCircle ?? {};
      const settings = await settingsOf(circle).loadShared();
      const resolved = resolveCadence({
        eventType: a.eventType,
        circle:      lc.cadences ?? {},
        user:      settings.cadenceOverrides ?? {},
      });
      return { resolved };
    }, {
      description: 'Resolve the effective cadence for an event (user > circle > baseline).',
    }),
  ];
}
