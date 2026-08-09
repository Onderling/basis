/**
 * tasks_briefSummary — contributor for basis's /brief
 * aggregator.  Post-V0 follow-up (2026-05-27) closing DESIGN gap #1
 * (`apps/basis/README.md` line 146).
 *
 * Manifest declaration: `apps/tasks-v0/manifest.js:listOpen` ->
 * `surfaces.chat.brief = { summarySkill: 'tasks_briefSummary',
 * order: 20, label: 'Tasks' }`.
 *
 * Reply shape mirrors:
 *   - `apps/folio/src/browser.js:280` (folio_briefSummary)
 *   - `apps/household/src/skills/briefSummary.js`
 *   - `apps/stoop/src/skills/index.js` (stoop_briefSummary)
 *
 * When the open-tasks list is empty we return `{ok: true}` — brief.js
 * skips that section.  Otherwise return `{items, message}` where
 * `items` is up to `MAX_ITEMS` rows with `{id, label}` and `message`
 * is the one-line aggregate ("N open tasks").
 *
 * Reads through the per-circle ItemStore — same data path the
 * `listOpen` skill uses.  Per-call: requires a resolvable circle via
 * the standard bundleResolver pattern.
 */

import { defineSkill } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — brief summary row cap (scope:device, kind:internal).
const MAX_ITEMS = param({ key: 'tasksV0.maxItems', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });

/**
 * Build the `tasks_briefSummary` skill.  Same factory shape as
 * `buildWorkspaceSkills`; consumed by `wireSkills.js`.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @returns {Array<object>}    one `defineSkill` per array entry
 */
export function buildBriefSummarySkill({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildBriefSummarySkill: bundleResolver(parts, ctx) required');
  }
  return [
    defineSkill('tasks_briefSummary', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const open = await circle.itemStore.listOpen({ type: 'task' });
      const all  = Array.isArray(open) ? open : [];
      if (all.length === 0) {
        // brief.js's isEmpty skips this section.
        return { ok: true };
      }
      const items = all.slice(0, MAX_ITEMS).map((it) => ({
        id:    it.id,
        label: it.text ?? it.title ?? it.id,
      }));
      const message = `${all.length} open task${all.length === 1 ? '' : 's'}`;
      return { items, message };
    }, {
      description: 'Q30 brief-summary contributor: open-tasks count + topmost rows.',
    }),
  ];
}
