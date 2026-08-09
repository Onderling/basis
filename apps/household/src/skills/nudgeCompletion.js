/**
 * skills/nudgeCompletion — compose the "what got done?" prompt that
 * the bot posts when a NudgeTimer matures.
 *
 * args : { chatId: string, itemIds?: Array<string> }
 *   - chatId   which chat to nudge in (typically the chat that emitted
 *              the trigger).  Currently unused inside the skill — the
 *              bridge layer routes the resulting Reply — but accepted
 *              and forwarded for symmetry with other skills.
 *   - itemIds  optional — narrow to specific items (the ones the
 *              NudgeTimer had pending).  When omitted, all currently-
 *              open items are included.
 *
 * ctx  : SkillContext
 *
 * reply: a single friendly text message.  Items are grouped by type
 *        in the order shopping → errand → repair → schedule.  When the
 *        list has ≤10 items, a `[✓ done]` inline button is attached
 *        per item with `id === item.id`.  >10 items renders the list
 *        without buttons (Telegram inline-keyboard cap).
 *
 *        If there are zero items left to nudge about (empty store, or
 *        all the supplied itemIds have been completed since the timer
 *        fired), returns `{ replies: [], stateUpdates: [] }` so the
 *        caller can skip posting silently.
 *
 * Emits no stateUpdates — this skill does not mutate state.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — item count above which inline done-buttons are dropped (scope:device, kind:internal).
const BUTTON_THRESHOLD = param({ key: 'household.nudgeButtonThreshold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 });

/** @type {Array<import('../types.js').ItemType>} */
const TYPE_ORDER = ['shopping', 'errand', 'repair', 'schedule'];
const TYPE_RANK = new Map(TYPE_ORDER.map((t, i) => [t, i]));

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function nudgeCompletion(args, ctx) {
  const { itemIds } = args ?? {};

  /** @type {Array<import('../types.js').Item>} */
  let items;
  if (Array.isArray(itemIds)) {
    const fetched = await Promise.all(itemIds.map((id) => ctx.store.getById(id)));
    items = fetched.filter(
      /** @returns {it is import('../types.js').Item} */
      (it) => it !== null && it.completedAt == null,   // open = completedAt absent (or null)
    );
  } else {
    items = await ctx.store.listOpen({});
  }

  if (items.length === 0) {
    return { replies: [], stateUpdates: [] };
  }

  // Stable sort by type rank then insertion order (existing order
  // preserved within a type group thanks to Array.prototype.sort being
  // stable in all supported runtimes).
  const sorted = [...items].sort((a, b) => {
    const ra = TYPE_RANK.has(a.type) ? TYPE_RANK.get(a.type) : TYPE_ORDER.length;
    const rb = TYPE_RANK.has(b.type) ? TYPE_RANK.get(b.type) : TYPE_ORDER.length;
    return ra - rb;
  });

  const lines = sorted.map((it) => `  • ${it.text} (${it.type})`);
  const text = [
    'Hi — anything done from the open list?',
    '',
    ...lines,
    '',
    'Reply with `done <item>` to mark complete, or just ignore this if not yet.',
  ].join('\n');

  /** @type {import('../types.js').ReplyMessage} */
  const message = { text };

  if (sorted.length <= BUTTON_THRESHOLD) {
    // Button id MUST be a parsable command (regex → markComplete).
    // See listOpen.js for the same pattern.
    message.buttons = sorted.map((it) => ({
      id: `done ${it.id}`,
      label: '✓ done',
    }));
  }

  return { replies: [message], stateUpdates: [] };
}
