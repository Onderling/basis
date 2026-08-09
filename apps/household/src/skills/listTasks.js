/**
 * skills/listTasks — list open task items.
 *
 * args : { since?: number }
 * ctx  : SkillContext
 * reply: numbered list of open tasks; with one `[take — <id-prefix>]`
 *        inline button per task when the list is small (≤10).
 *
 * Emits no stateUpdates.  Mirrors `listOpen`'s shape; the difference
 * is the buttons map to `claim <id>` (the verb) instead of
 * `done <id>`.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — id-prefix length, label cap, and button-drop threshold (scope:device, kind:internal).
const ID_PREFIX_LEN = param({ key: 'household.listTasksIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const LABEL_MAX = param({ key: 'household.listTasksLabelMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 });
const BUTTON_THRESHOLD = param({ key: 'household.listTasksButtonThreshold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 });

function shortLabel(text, fallback) {
  const t = String(text ?? '').trim();
  if (t.length === 0) return fallback;
  if (t.length <= LABEL_MAX) return t;
  return t.slice(0, LABEL_MAX - 1) + '…';
}

export async function listTasks(args, ctx) {
  const { since } = args ?? {};
  const items = await ctx.store.listOpen({ type: 'task', since });

  if (items.length === 0) {
    return {
      replies:      [{ text: `Nothing open in tasks.` }],
      stateUpdates: [],
    };
  }

  const lines   = items.map((it, idx) => `${idx + 1}. ${it.text}`);
  const message = { text: `tasks:\n${lines.join('\n')}` };

  if (items.length <= BUTTON_THRESHOLD) {
    message.buttons = items.map((it) => ({
      id:    `claim ${it.id}`,
      label: `Take ${shortLabel(it.text, it.id.slice(0, ID_PREFIX_LEN))}`,
    }));
  }

  return { replies: [message], stateUpdates: [] };
}
