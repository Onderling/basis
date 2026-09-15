/**
 * calendarEmission — Tasks admin/self skills for the
 * calendar-write side-channel.
 *
 * Three skills:
 *   - `setCalendarEmission({enabled})` — admin/coord. Toggles
 *     `liveCircle.calendarEmission.enabled`.
 *   - `getCalendarEmissionUrl()`       — self. Returns the URL the
 *     calling actor's calendar app subscribes to.
 *   - `getCalendarEmissionStatus()`    — self. Returns whether
 *     emission is on for the circle, plus the actor's URL when it is.
 *
 * The actual emit-loop lives in `../calendar/wireCalendarEmission.js`
 * and is wired by `Circle.js` per-member when `liveCircle.calendarEmission?.enabled`
 * is true. The skill calls `circle.onCalendarEmissionChange?.()` after
 * toggling so Circle.js can attach/detach the per-member loops.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolver returns a CircleState; per-CircleState `onCalendarEmissionChange`
 *   callback wires the rewire loop in `Circle.js`.
 */
export function buildCalendarEmissionSkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildCalendarEmissionSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('setCalendarEmission', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const a = argsFromParts(parts);
      if (typeof a.enabled !== 'boolean') {
        return { error: 'enabled (boolean) required' };
      }
      const lc = circle.liveCircle ?? {};
      const next = { ...(lc.calendarEmission ?? {}), enabled: a.enabled };
      circle.circleMutator({ calendarEmission: next });
      try { circle.onCalendarEmissionChange?.(); } catch { /* re-wire failure must not break the toggle skill */ }
      return { ok: true, enabled: a.enabled };
    }, {
      description: 'Toggle calendar emission for the circle (admin/coord only).',
      visibility:  'authenticated',
    }),

    defineSkill('getCalendarEmissionUrl', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }
      const lc = circle.liveCircle ?? {};
      const enabled = !!lc.calendarEmission?.enabled;
      if (!enabled) {
        return {
          enabled: false,
          url:     null,
          path:    null,
        };
      }
      // Per-member path so each member subscribes to their own filtered
      // calendar (containing tasks they're assigned, master, or approver of).
      const path = `mem://user/tasks/calendars/${encodeURIComponent(lc.circleId ?? 'unknown')}-${encodeURIComponent(from)}.ics`;
      return {
        enabled: true,
        path,
        // The agent-ui's static-file overlay translates mem:// paths
        // to http:// URLs the host is reachable on; CLI surfaces the
        // mem:// path verbatim and the agent-ui layer rewrites.
        url: path,
      };
    }, {
      description: 'Return the calendar URL the calling actor should subscribe to.',
      visibility:  'authenticated',
    }),

    defineSkill('getCalendarEmissionStatus', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const lc = circle.liveCircle ?? {};
      const enabled = !!lc.calendarEmission?.enabled;
      const role = await roleOf(circle, from);
      const canToggle = role === 'admin' || role === 'coordinator';
      return {
        enabled,
        canToggle,
        ...(enabled && from
          ? { path: `mem://user/tasks/calendars/${encodeURIComponent(lc.circleId ?? 'unknown')}-${encodeURIComponent(from)}.ics` }
          : {}),
      };
    }, {
      description: 'Read the calendar-emission flag + the URL when on.',
      visibility:  'authenticated',
    }),
  ];
}
