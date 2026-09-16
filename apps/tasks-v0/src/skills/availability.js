/**
 * availability — Tasks hint skills.
 *
 *   - `setMyAvailability({week, day, half, state})` — self only.
 *   - `getMyAvailability({week?})`                  — self only.
 *   - `getCircleAvailability({week?})`                — coord/admin only.
 *   - `setAvailabilityOptIn({optedIn})`             — self only.
 *   - `setAvailabilityEnabled({enabled})`           — admin only.
 *
 * Hints persist as JSON blobs at:
 *   `mem://tasks/circles/<circleId>/availability/<webid>.json`
 *
 * Trust boundary:
 *   - 'unknown' is the absent state. Coordinator view shows 'unknown'
 *     for any member who hasn't opted in (indistinguishable from
 *     "opted in but no hints set").
 *   - Members opt in per-circle (per-member flag in MemberMap).
 *   - Disabling circle-wide hints rejects all set/get calls.
 *   - Hints older than 4 ISO weeks are pruned at read-time.
 */

import { defineSkill } from '@onderling/core';

import { AvailabilityHints, isoWeekOf } from '../availability/AvailabilityHints.js';
import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

function hintPath(circleId, webid) {
  return `mem://tasks/circles/${encodeURIComponent(circleId)}/availability/${encodeURIComponent(webid)}.json`;
}

async function loadHints(dataSource, path) {
  try {
    const raw = await dataSource.read(path);
    if (!raw) return new AvailabilityHints();
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const h = AvailabilityHints.deserialize(obj);
    h.pruneStale();
    return h;
  } catch {
    return new AvailabilityHints();
  }
}

async function saveHints(dataSource, path, hints) {
  try {
    hints.pruneStale();
    await dataSource.write(path, JSON.stringify(hints.serialize()));
  } catch { /* persistence failure is non-fatal */ }
}

/**
 * Per-member opt-in flag lives on `circleConfig.availabilityHints.optedIn[webid]`
 * (a Set persisted as an array). Stored on the live circle so it
 * propagates to admin views via `getCircleAvailability` filtering.
 */
function isOptedIn(circle, webid) {
  const list = circle?.availabilityHints?.optedIn ?? [];
  return Array.isArray(list) && list.includes(webid);
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildAvailabilitySkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildAvailabilitySkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('setAvailabilityEnabled', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.enabled !== 'boolean') return { error: 'enabled (boolean) required' };
      const lc = circle.liveCircle ?? {};
      circle.circleMutator({
        availabilityHints: { ...(lc.availabilityHints ?? {}), enabled: a.enabled },
      });
      return { ok: true, enabled: a.enabled };
    }, {
      description: 'Turn the availability-hints feature on/off for the circle (admin only).',
      visibility:  'authenticated',
    }),

    defineSkill('setAvailabilityOptIn', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof a.optedIn !== 'boolean') return { error: 'optedIn (boolean) required' };
      if (typeof from !== 'string' || !from) return { error: 'webid required (from envelope)' };
      const lc = circle.liveCircle ?? {};
      if (!lc.availabilityHints?.enabled) {
        return { error: 'availability-hints-disabled' };
      }
      const list = new Set(Array.isArray(lc.availabilityHints?.optedIn)
        ? lc.availabilityHints.optedIn
        : []);
      if (a.optedIn) list.add(from);
      else           list.delete(from);
      circle.circleMutator({
        availabilityHints: { ...(lc.availabilityHints ?? {}), optedIn: [...list] },
      });
      // Opting OUT also clears the persisted hints — no leftover data.
      if (!a.optedIn) {
        try { await circle.dataSource.delete?.(hintPath(lc.circleId, from)); } catch { /* noop */ }
      }
      return { ok: true, optedIn: a.optedIn };
    }, {
      description: 'Opt this member in or out of broadcasting availability hints in this circle.',
      visibility:  'authenticated',
    }),

    defineSkill('setMyAvailability', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      const lc = circle.liveCircle ?? {};
      if (!lc.availabilityHints?.enabled) return { error: 'availability-hints-disabled' };
      if (!isOptedIn(lc, from))           return { error: 'not opted in — call setAvailabilityOptIn first' };

      const path = hintPath(lc.circleId, from);
      const hints = await loadHints(circle.dataSource, path);
      try {
        hints.set({ week: a.week, day: a.day, half: a.half, state: a.state });
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
      await saveHints(circle.dataSource, path, hints);
      return { ok: true, week: a.week, day: a.day, half: a.half, state: a.state };
    }, {
      description: 'Set my own availability for one half-day cell.',
      visibility:  'authenticated',
    }),

    defineSkill('getMyAvailability', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      if (typeof from !== 'string' || !from) return { error: 'webid required' };
      const lc = circle.liveCircle ?? {};
      if (!lc.availabilityHints?.enabled) return { enabled: false, week: null, grid: {} };
      const week = typeof a.week === 'string' && /^\d{4}-W\d{2}$/.test(a.week)
        ? a.week
        : isoWeekOf(new Date());
      const path = hintPath(lc.circleId, from);
      const hints = await loadHints(circle.dataSource, path);
      return {
        enabled: true,
        optedIn: isOptedIn(lc, from),
        week,
        grid: hints.weekGrid(week),
      };
    }, {
      description: 'Read my own availability grid for a week.',
      visibility:  'authenticated',
    }),

    defineSkill('getCircleAvailability', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const a = argsFromParts(parts);
      const lc = circle.liveCircle ?? {};
      if (!lc.availabilityHints?.enabled) return { enabled: false, week: null, members: [] };
      const week = typeof a.week === 'string' && /^\d{4}-W\d{2}$/.test(a.week)
        ? a.week
        : isoWeekOf(new Date());

      const out = [];
      for (const m of lc.members ?? []) {
        if (!m?.webid) continue;
        if (!isOptedIn(lc, m.webid)) {
          out.push({ webid: m.webid, displayName: m.displayName, grid: {} });
          continue;
        }
        const path = hintPath(lc.circleId, m.webid);
        const hints = await loadHints(circle.dataSource, path);
        out.push({ webid: m.webid, displayName: m.displayName, grid: hints.weekGrid(week) });
      }
      return { enabled: true, week, members: out };
    }, {
      description: 'Read every opted-in member\'s availability grid (admin/coord only).',
      visibility:  'authenticated',
    }),
  ];
}

export { hintPath };
