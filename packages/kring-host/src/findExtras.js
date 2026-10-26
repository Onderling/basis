/**
 * Shared find-result enrichment — the LOGIC that both surfaces (web `circleApp.js`
 * and mobile `CircleLauncherScreen.js`) run after a /find reply, so it lives ONCE here instead of being
 * re-implemented per shell.
 *
 * Given the /find query, it fetches the circle roster via the injected origin-resolving `callSkill(opId, args)`
 * and returns the SKILL MATCHES: circle members whose declared skills overlap the query (top 5).
 *
 * Pure decision + fetch; the caller renders the returned shape into its own bubble UI (web botBubble / mobile
 * appendCircleMessage). The building block (findOfferingMatches) is the same shared module.
 */
import { findOfferingMatches } from './findOfferingMatches.js';
import { normalizeCircleMembers } from './circleMembers.js';

/**
 * @param {object} a
 * @param {string}   a.query                       the /find query
 * @param {string}   a.circleId                     active circle id
 * @param {(opId:string, args:object)=>Promise<any>} a.callSkill  origin-resolving skill caller
 * @returns {Promise<{offeringMatches:Array<{label:string,skill:string}>}>}
 */
export async function buildFindExtras({ query, circleId, callSkill } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q || typeof callSkill !== 'function') return { offeringMatches: [] };

  let members = [];
  try { members = normalizeCircleMembers(await callSkill('listGroupMembers', { groupId: circleId })); } catch { /* no roster */ }
  const matches = findOfferingMatches({ query: q, members });

  return { offeringMatches: matches.slice(0, 5).map((m) => ({ label: m.label, skill: m.skill })) };
}
