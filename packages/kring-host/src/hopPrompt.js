/**
 * basis v2 — auto-hop-prompt.
 *
 * When a skill-search inside the user's circles returns ZERO matches AND
 * the user has at least one hop-eligible contact, the chat-shell should
 * surface a follow-up card:
 *
 *   "I can't find anyone in your circles with that skill.
 *    Want me to search further via your contacts?
 *      [Yes, one step further]   [Skip]"
 *
 * Pure / DI: the chat-shell host wires the actual search + hop-relay
 * dispatch.  This module decides *whether* to prompt, formats the card
 * structure, and tracks an optional dismissal so we don't re-prompt the
 * same skill back-to-back.
 *
 * The chat-shell integration (rendering the card as a chat bubble +
 * routing the "Yes" tap to `makeHopRelayRequest` over the existing
 * hop-relay substrate) is the follow-up — this slice ships the
 * decision + presentation model + tests.
 */

import { MAX_HOPS } from './circleHop.js';

/**
 * Decide whether to surface the auto-hop prompt.
 *
 * @param {object} args
 * @param {number} [args.inCircleMatchCount=0]  count of skill-match hits within the user's circles
 * @param {number} [args.hopEligibleContactsCount=0]  count of contacts whose hopThrough flag permits relay
 * @param {boolean} [args.hopGloballyOn=true]  user's global hop stance (Pinboard getHopMode().global)
 * @param {boolean} [args.dismissedForSkill=false]  user already said "Skip" for this query in this session
 * @returns {{prompt: boolean, reason: string|null}}
 */
export function shouldAutoSuggestHop({
  inCircleMatchCount = 0,
  hopEligibleContactsCount = 0,
  hopGloballyOn = true,
  dismissedForSkill = false,
} = {}) {
  if (dismissedForSkill)              return { prompt: false, reason: 'dismissed' };
  if (!hopGloballyOn)                  return { prompt: false, reason: 'hop-off' };
  if (inCircleMatchCount > 0)          return { prompt: false, reason: 'have-matches' };
  if (hopEligibleContactsCount <= 0)   return { prompt: false, reason: 'no-eligible-contacts' };
  return { prompt: true, reason: null };
}

/**
 * Build the structured card the chat-shell renders when the prompt
 * fires.  Pure (uses the host translator); the host wires `onAccept` /
 * `onDismiss` to its dispatch + dismissal sink.
 *
 * @param {object} args
 * @param {string} args.skillQuery                  raw user query string (e.g. "badkamers")
 * @param {number} [args.hopEligibleContactsCount]  count of relay-eligible contacts
 * @param {function} args.t                         host translator
 * @returns {{
 *   id: string,
 *   skillQuery: string,
 *   title: string,
 *   body: string,
 *   accept: { label: string, action: 'hop-relay' },
 *   dismiss: { label: string, action: 'skip-hop' },
 * }}
 */
export function buildHopPromptCard({
  skillQuery,
  hopEligibleContactsCount = 0,
  t,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const safeQuery = typeof skillQuery === 'string' ? skillQuery.trim() : '';
  return {
    id:         `hop-prompt-${Date.now().toString(36)}`,
    skillQuery: safeQuery,
    title:      tr('circle.hopPrompt.title'),
    body:       safeQuery
      ? tr('circle.hopPrompt.body', { skill: safeQuery, count: hopEligibleContactsCount })
      : tr('circle.hopPrompt.body_anon', { count: hopEligibleContactsCount }),
    accept:  { label: tr('circle.hopPrompt.accept'),  action: 'hop-relay' },
    dismiss: { label: tr('circle.hopPrompt.dismiss'), action: 'skip-hop' },
  };
}

/**
 * Track per-session dismissal: when the user taps "Skip", record the
 * skill query so a back-to-back identical search doesn't re-prompt.
 * Pure: returns a new Set so React state updates are diff-able.
 *
 * @param {Set<string>|null|undefined} dismissed
 * @param {string} skillQuery
 * @returns {Set<string>}
 */
export function rememberDismissed(dismissed, skillQuery) {
  const out = new Set(dismissed instanceof Set ? dismissed : []);
  const key = normalizeSkillKey(skillQuery);
  if (key) out.add(key);
  return out;
}

/** Same-key check: dismissal is per-query, normalised (case + whitespace). */
export function hasDismissed(dismissed, skillQuery) {
  if (!(dismissed instanceof Set)) return false;
  const key = normalizeSkillKey(skillQuery);
  if (!key) return false;
  return dismissed.has(key);
}

function normalizeSkillKey(s) {
  if (typeof s !== 'string') return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export { MAX_HOPS };
