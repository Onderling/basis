/**
 * Shared find-result enrichment — the LOGIC that both surfaces (web `circleApp.js`
 * and mobile `CircleLauncherScreen.js`) run after a /find reply, so it lives ONCE here instead of being
 * re-implemented per shell.
 *
 * Given the /find query + result groups, it fetches the circle roster + hop info via the injected
 * origin-resolving `callSkill(opId, args)` and decides:
 *   1. SKILL MATCHES — circle members whose declared skills overlap the query (top 5).
 *   2. HOP PROMPT — when the search came up short AND the user has hop-eligible contacts AND hop is globally
 *      on, a "search one step further?" card (localised via the injected `t`).
 *
 * Pure decision + fetch; the caller renders the returned shape into its own bubble UI (web botBubble / mobile
 * appendCircleMessage). Building blocks (findOfferingMatches / hopPrompt) are the same shared modules.
 */
import { findOfferingMatches } from './findOfferingMatches.js';
import { shouldAutoSuggestHop, buildHopPromptCard } from './hopPrompt.js';
import { normalizeCircleMembers } from './circleMembers.js';

/**
 * @param {object} a
 * @param {string}   a.query                       the /find query
 * @param {Array}    [a.groups]                     the find reply's groups (for the item count)
 * @param {string}   a.circleId                     active circle id
 * @param {(opId:string, args:object)=>Promise<any>} a.callSkill  origin-resolving skill caller
 * @param {Function} a.t                            translator (for the hop card copy)
 * @returns {Promise<{offeringMatches:Array<{label:string,skill:string}>, hopCard:{title:string,body:string}|null}>}
 */
export async function buildFindExtras({ query, groups, circleId, callSkill, t } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q || typeof callSkill !== 'function') return { offeringMatches: [], hopCard: null };

  const itemCount = (Array.isArray(groups) ? groups : [])
    .reduce((n, g) => n + (Array.isArray(g.items) ? g.items.length : 0), 0);

  let members = [];
  try { members = normalizeCircleMembers(await callSkill('listGroupMembers', { groupId: circleId })); } catch { /* no roster */ }
  const matches = findOfferingMatches({ query: q, members });

  let hopCard = null;
  // Only prompt to hop when we DIDN'T already show something useful (items + in-circle matches).
  if (!(itemCount > 0 && matches.length > 0)) {
    let hopGloballyOn = false;
    let hopEligibleContactsCount = 0;
    try {
      const hopMode = await callSkill('getHopMode', {});
      hopGloballyOn = hopMode?.global === true;
      const contacts = await callSkill('listContacts', {});
      const list = Array.isArray(contacts?.items) ? contacts.items
                 : Array.isArray(contacts?.contacts) ? contacts.contacts
                 : Array.isArray(contacts) ? contacts : [];
      hopEligibleContactsCount = list.filter((c) => c?.hopThrough === true || c?.hopThrough === 'always' || c?.hopThrough === 'with-ok').length;
    } catch { /* defaults */ }
    const decision = shouldAutoSuggestHop({ inCircleMatchCount: matches.length, hopEligibleContactsCount, hopGloballyOn, dismissedForSkill: false });
    if (decision.prompt) hopCard = buildHopPromptCard({ skillQuery: q, hopEligibleContactsCount, t });
  }

  return { offeringMatches: matches.slice(0, 5).map((m) => ({ label: m.label, skill: m.skill })), hopCard };
}
