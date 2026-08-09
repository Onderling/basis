/**
 * skills/reassign — reassign a task to a different webid.
 *
 * args  : { match: string, assignee: string }   // match = id/keyword
 * ctx   : SkillContext
 * reply : like `claim` — 0/1/N match resolution; on 1 → store.reassign.
 *
 * V0: LLM-only (no slash match in the manifest — two-arg slash
 * forms aren't in the v0 grammar).  `args.assignee` must be a webid;
 * no fuzzy lookup against contact display names yet (forward-compat
 * opportunity once `@onderling/identity-resolver` lands).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — displayed id-prefix length + minimum prefix accepted for matching (scope:device, kind:internal).
const ID_PREFIX_LEN  = param({ key: 'household.reassignIdPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });
const MIN_PREFIX_LEN = param({ key: 'household.reassignMinPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

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

export async function reassign(args, ctx) {
  const { match, assignee } = args ?? {};

  if (typeof match !== 'string' || match.trim() === '') {
    return {
      replies:      [{ text: `Couldn't reassign — no match keyword given.` }],
      stateUpdates: [],
    };
  }
  if (typeof assignee !== 'string' || assignee.trim() === '') {
    return {
      replies:      [{ text: `Couldn't reassign — no assignee webid given.` }],
      stateUpdates: [],
    };
  }
  if (typeof ctx.store.reassign !== 'function') {
    return {
      replies:      [{ text: `Couldn't reassign — store doesn't support reassign.` }],
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

  const item = candidates[0];
  await ctx.store.reassign(item.id, assignee.trim(), ctx.senderWebid);

  return {
    replies:      [{ text: `✓ reassigned: ${item.text} → ${assignee.trim()}` }],
    stateUpdates: [{ kind: 'item.reassigned', itemId: item.id, chatId: ctx.chatId }],
  };
}
