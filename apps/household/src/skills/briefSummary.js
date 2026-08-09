/**
 * skills/briefSummary — contributor for the basis /brief
 * aggregator.
 *
 * Returns a count of open household items + the topmost row so the
 * /brief fan-out can render a one-line "Household" section.
 *
 * Skill name in the manifest is `household_briefSummary` (matches
 * calendar's `calendar_briefSummary` + folio's `folio_briefSummary`
 * conventions — `<app>_briefSummary` so multi-app hosts can compose
 * the skills onto a shared agent without collisions).
 *
 * Reply shape mirrors folio's `folio_briefSummary` + calendar's
 * `briefSummary`: when the store is empty we return `{ok: true}`
 * (brief.js's isEmpty skips that section); otherwise we return
 * `{items, message}`.
 *
 * args: none (brief skills take no args)
 * ctx  : SkillContext (ctx.store.listOpen())
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — cap on items surfaced in the brief section (scope:device, kind:internal).
const MAX_ITEMS = param({ key: 'household.briefMaxItems', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function briefSummary(_args, ctx) {
  const open = await ctx.store.listOpen({});
  if (!open || open.length === 0) {
    return {
      replies: [{ ok: true }],  // brief.js's isEmpty skips this section
      stateUpdates: [],
    };
  }
  const items = open.slice(0, MAX_ITEMS).map((it) => ({
    id:    it.id,
    label: it.text,
  }));
  const message = `${open.length} open household item${open.length === 1 ? '' : 's'}`;
  return {
    replies: [{ items, message }],
    stateUpdates: [],
  };
}
