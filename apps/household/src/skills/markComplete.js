/**
 * skills/markComplete — mark an open item complete.
 *
 * args : { match: string }   // id, id-prefix (≥6 chars), or fuzzy keyword
 * ctx  : SkillContext
 * reply:
 *   - 0 matches → "Couldn't find an open item matching '<match>'."
 *   - 1 match   → call store.markComplete; reply "✓ marked complete: <text>";
 *                 emit `item.completed`.
 *   - >1 matches → list candidates with their id-prefixes for the user
 *                  to disambiguate.
 *
 * Resolution order: id-exact, then id-prefix, then text-contains
 * (case-insensitive).  Only open items are considered.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — displayed id-prefix length + minimum prefix accepted for matching (scope:device, kind:internal).
const ID_PREFIX_LEN = param({ key: 'household.markCompleteIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const MIN_PREFIX_LEN = param({ key: 'household.markCompleteMinPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

/**
 * @param {Array<import('../types.js').Item>} items
 * @param {string} match
 * @returns {Array<import('../types.js').Item>}
 */
function resolveCandidates(items, match) {
  const m = match.trim();
  // 1) id exact
  const exact = items.find((i) => i.id === m);
  if (exact) return [exact];

  // 2) id-prefix (only if reasonably long to avoid false hits)
  if (m.length >= MIN_PREFIX_LEN) {
    const upper = m.toUpperCase();
    const prefixHits = items.filter((i) => i.id.startsWith(upper));
    if (prefixHits.length === 1) return prefixHits;
    if (prefixHits.length > 1) return prefixHits;
  }

  // 3) text-contains, case-insensitive
  const lower = m.toLowerCase();
  return items.filter((i) => i.text.toLowerCase().includes(lower));
}

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function markComplete(args, ctx) {
  const { match } = args ?? {};

  if (typeof match !== 'string' || match.trim() === '') {
    return {
      replies: [{ text: `Couldn't mark complete — no match keyword given.` }],
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
  await ctx.store.markComplete(item.id);

  return {
    replies: [{ text: `✓ marked complete: ${item.text}` }],
    stateUpdates: [
      { kind: 'item.completed', itemId: item.id, chatId: ctx.chatId },
    ],
  };
}
