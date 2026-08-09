/**
 * skills/listOpen — list open items of a type.
 *
 * args : { type?: ItemType, since?: number }   // both optional
 * ctx  : SkillContext
 * reply: numbered list, with one `[mark done — <id-prefix>]` button per
 *        item if the list is small (≤10).  Empty list is a friendly
 *        "Nothing open in <type>." message.
 *
 * Emits no stateUpdates.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — id-prefix length + inline-button label cap (scope:device, kind:internal).
const ID_PREFIX_LEN = param({ key: 'household.listOpenIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const LABEL_MAX = param({ key: 'household.listOpenLabelMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 });          // Telegram inline buttons clip past ~30 chars on narrow screens

function shortLabel(text, fallback) {
  const t = String(text ?? '').trim();
  if (t.length === 0) return fallback;
  if (t.length <= LABEL_MAX) return t;
  return t.slice(0, LABEL_MAX - 1) + '…';
}
// Parameter register (#36) — item count above which inline buttons are dropped (scope:device, kind:internal).
const BUTTON_THRESHOLD = param({ key: 'household.listOpenButtonThreshold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 });
const KNOWN_TYPES = new Set(['shopping', 'errand', 'repair', 'schedule']);

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function listOpen(args, ctx) {
  const { type, since } = args ?? {};

  if (type !== undefined && !KNOWN_TYPES.has(type)) {
    return {
      replies: [
        {
          text:
            `Couldn't list — unknown type "${type}". ` +
            `Known: shopping, errand, repair, schedule.`,
        },
      ],
      stateUpdates: [],
    };
  }

  const items = await ctx.store.listOpen({ type, since });

  if (items.length === 0) {
    const label = type ?? 'any list';
    return {
      replies: [{ text: `Nothing open in ${label}.` }],
      stateUpdates: [],
    };
  }

  const header = type ? `${type}:` : 'open items:';
  const lines = items.map((it, idx) => `${idx + 1}. ${it.text}`);
  const text = `${header}\n${lines.join('\n')}`;

  /** @type {import('../types.js').ReplyMessage} */
  const message = { text };

  if (items.length <= BUTTON_THRESHOLD) {
    // Button id MUST be a parsable command — when the user taps,
    // Telegram fires a callback_query whose `data` becomes the
    // synthesised IncomingMessage's `text`.  `done <ULID>` routes
    // cleanly through the regex parser → markComplete skill.
    //
    // Label uses the item TEXT (truncated) — much more recognisable
    // than a ULID prefix.  Falls back to the prefix only if text is
    // empty (shouldn't happen, but defensive).
    message.buttons = items.map((it) => ({
      id: `done ${it.id}`,
      label: `✓ ${shortLabel(it.text, it.id.slice(0, ID_PREFIX_LEN))}`,
    }));
  }

  return { replies: [message], stateUpdates: [] };
}
