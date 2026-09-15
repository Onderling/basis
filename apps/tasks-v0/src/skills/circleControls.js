/**
 * circleControls — Tasks V1 Phase 10 lifecycle controls.
 *
 * Five skills:
 *
 *   - `pauseCircle()`      — admin/coord only. Sets `circle.paused = true`.
 *   - `unpauseCircle()`    — admin/coord only. Clears `circle.paused`.
 *   - `archiveCircle()`    — admin only. Sets `circle.archived = true`.
 *                          Reversible — does NOT delete items.
 *   - `unarchiveCircle()`  — admin only. Clears `circle.archived`.
 *   - `getPrivacyNotice({lang?})` — returns the localised
 *                          closed-beta privacy notice; default `en`.
 *
 * The pause/archive flags are honoured by `addTask` (in
 * `src/skills/index.js`) — when paused or archived, addTask returns
 * `{error: 'circle-paused' | 'circle-archived'}` instead of writing.
 *
 * Other skills (claim, complete, submit, approve, reject, revoke,
 * addSubtask) are NOT blocked by pause — paused circles keep
 * processing existing tasks; they only block creating new ones.
 * Archived circles block all mutations except read + close-out.
 *
 * The circle config is mutated through `circle.circleMutator(patch)` so the
 * Circle.js wiring keeps the `liveCircle` pointer in sync (frozen-copy
 * swap pattern).
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { privacyNoticeFor } from '../lib/privacyNotice.js';
import { makeRoleOf } from './roleOf.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildCircleControlSkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildCircleControlSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('pauseCircle', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      circle.circleMutator({ paused: true });
      return { ok: true, paused: !!circle.liveCircle?.paused };
    }, {
      description: 'Pause the circle — blocks new tasks; existing tasks remain workable.',
    }),

    defineSkill('unpauseCircle', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      circle.circleMutator({ paused: false });
      return { ok: true, paused: !!circle.liveCircle?.paused };
    }, {
      description: 'Resume the circle after a pause.',
    }),

    defineSkill('archiveCircle', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') {
        return { error: 'admin required' };
      }
      circle.circleMutator({ archived: true });
      return { ok: true, archived: !!circle.liveCircle?.archived };
    }, {
      description: 'Archive the circle — read-only ledger; reversible via unarchiveCircle.',
    }),

    defineSkill('unarchiveCircle', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') {
        return { error: 'admin required' };
      }
      circle.circleMutator({ archived: false });
      return { ok: true, archived: !!circle.liveCircle?.archived };
    }, {
      description: 'Reverse an archive.',
    }),

    defineSkill('getPrivacyNotice', async ({ parts }) => {
      const a = argsFromParts(parts);
      const lang = typeof a.lang === 'string' && a.lang ? a.lang : 'en';
      return { lang, items: privacyNoticeFor(lang) };
    }, {
      description: 'Return the localised closed-beta privacy notice.',
    }),
  ];
}
