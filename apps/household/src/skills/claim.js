/**
 * skills/claim — claim an open task.
 *
 * args  : { match: string }   // id, id-prefix (≥6), or fuzzy keyword
 * ctx   : SkillContext
 * reply :
 *   - 0 matches → "Couldn't find an open task matching '<match>'."
 *   - 1 match   → call store.claim; reply "✓ claimed: <text>";
 *                 emit `item.claimed`.  If already claimed, surface that
 *                 (no error to the user — the substrate's
 *                 already-claimed shape is treated as a soft fail).
 *   - >1 matches → list candidates for disambiguation.
 *
 * Resolution mirrors markComplete: id-exact → id-prefix (≥6) →
 * text-contains.  Considers only open `task` items.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — displayed id-prefix length + minimum prefix accepted for matching (scope:device, kind:internal).
const ID_PREFIX_LEN  = param({ key: 'household.claimIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const MIN_PREFIX_LEN = param({ key: 'household.claimMinPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

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

export async function claim(args, ctx) {
  const { match } = args ?? {};

  if (typeof match !== 'string' || match.trim() === '') {
    return {
      replies:      [{ text: `Couldn't claim — no match keyword given.` }],
      stateUpdates: [],
    };
  }
  if (typeof ctx.store.claim !== 'function') {
    return {
      replies:      [{ text: `Couldn't claim — store doesn't support claim.` }],
      stateUpdates: [],
    };
  }

  const open       = await ctx.store.listOpen({ type: 'task' });
  const candidates = resolveCandidates(open, match);

  if (candidates.length === 0) {
    return {
      replies:      [{ text: `Couldn't find an open task matching '${match}'.` }],
      stateUpdates: [],
    };
  }
  if (candidates.length > 1) {
    const lines = candidates.map(
      (it) => `- [${it.id.slice(0, ID_PREFIX_LEN)}] ${it.text}`,
    );
    return {
      replies: [{
        text:
          `Multiple matches for '${match}'. ` +
          `Reply with the id-prefix:\n${lines.join('\n')}`,
      }],
      stateUpdates: [],
    };
  }

  const item   = candidates[0];
  const result = await ctx.store.claim(item.id, ctx.senderWebid);

  if (result?.error === 'already-claimed') {
    return {
      replies: [{
        text: `Task already claimed by ${result.current?.assignee ?? 'someone'}.`,
      }],
      stateUpdates: [],
    };
  }

  return {
    replies:      [{ text: `✓ claimed: ${item.text}` }],
    stateUpdates: [{ kind: 'item.claimed', itemId: item.id, chatId: ctx.chatId }],
  };
}
