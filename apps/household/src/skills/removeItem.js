/**
 * skills/removeItem — hard-delete an open item.
 *
 * args : { match: string }   // id, id-prefix (≥6), or fuzzy keyword
 * ctx  : SkillContext
 * reply:
 *   - 0 matches → "Couldn't find an open item matching '<match>'."
 *   - 1 match   → call store.remove; reply "✓ removed: <text>";
 *                 emit `item.removed`.
 *   - >1 matches → list candidates for disambiguation.
 *
 * Same resolution strategy as `markComplete` but ends in a hard
 * delete.  Use when the item shouldn't have been there in the first
 * place (vs `done` for the normal completion path).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — displayed id-prefix length + minimum prefix accepted for matching (scope:device, kind:internal).
const ID_PREFIX_LEN = param({ key: 'household.removeItemIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const MIN_PREFIX_LEN = param({ key: 'household.removeItemMinPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

/**
 * @param {Array<import('../types.js').Item>} items
 * @param {string} match
 * @returns {Array<import('../types.js').Item>}
 */
function resolveCandidates(items, match) {
  const m = match.trim();
  const exact = items.find((i) => i.id === m);
  if (exact) return [exact];

  if (m.length >= MIN_PREFIX_LEN) {
    const upper = m.toUpperCase();
    const prefixHits = items.filter((i) => i.id.startsWith(upper));
    if (prefixHits.length >= 1) return prefixHits;
  }

  const lower = m.toLowerCase();
  return items.filter((i) => i.text.toLowerCase().includes(lower));
}

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function removeItem(args, ctx) {
  const { match } = args ?? {};

  if (typeof match !== 'string' || match.trim() === '') {
    return {
      replies: [{ text: `Couldn't remove — no match keyword given.` }],
      stateUpdates: [],
    };
  }

  const open = await ctx.store.listOpen();
  const candidates = resolveCandidates(open, match);

  if (candidates.length === 0) {
    return {
      replies: [
        { text: `Couldn't find an open item matching '${match}'.` },
      ],
      stateUpdates: [],
    };
  }

  if (candidates.length > 1) {
    const lines = candidates.map(
      (it) => `- [${it.id.slice(0, ID_PREFIX_LEN)}] ${it.text}`,
    );
    return {
      replies: [
        {
          text:
            `Multiple matches for '${match}'. ` +
            `Reply with the id-prefix:\n${lines.join('\n')}`,
        },
      ],
      stateUpdates: [],
    };
  }

  const item = candidates[0];
  await ctx.store.remove(item.id);

  return {
    replies: [{ text: `✓ removed: ${item.text}` }],
    stateUpdates: [
      { kind: 'item.removed', itemId: item.id, chatId: ctx.chatId },
    ],
  };
}
