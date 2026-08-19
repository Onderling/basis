/**
 * messageScope — whether a circle message is private to YOU or reaches the WHOLE
 * circle. A trust/privacy property of the message DATA (carried on the event), so
 * the interface is just one — swappable — presentation of it.
 *
 *   self   — private to you: a bot's info answer, a clarification, an error.
 *            Nobody else sees it (bot text replies are local, never fanned out).
 *   circle  — reaches every member: your own broadcast messages, and bot replies
 *            for an op that MUTATED shared circle state (a post, a task add/claim,
 *            an RSVP …) — the *effect* is shared even though the confirmation text
 *            is local. The marker reflects the true reach, not just "was this text
 *            sent to peers".
 *
 * The determination is a heuristic on the op's `verb` for now (read verbs →
 * self, mutating verbs → circle); a later refinement can let the manifest declare
 * an op's scope explicitly. Pure + shared web↔mobile.
 */

export const MESSAGE_SCOPES = Object.freeze(['self', 'circle']);
export const DEFAULT_MESSAGE_SCOPE = 'self';

// Verbs whose ops READ shared state (a private answer) rather than mutate it.
const READ_VERBS = new Set([
  'list', 'help', 'get', 'show', 'search', 'find', 'brief', 'status', 'lookup', 'whoami', 'me',
]);

export function normalizeMessageScope(scope) {
  return MESSAGE_SCOPES.includes(scope) ? scope : DEFAULT_MESSAGE_SCOPE;
}

/** Scope implied by an op's verb: read → self, mutate (or unknown) → circle. */
export function scopeForVerb(verb) {
  if (typeof verb !== 'string' || !verb) return DEFAULT_MESSAGE_SCOPE;
  return READ_VERBS.has(verb) ? 'self' : 'circle';
}

/**
 * Scope of a BOT reply. An error / clarification is private (between you and the
 * bot); otherwise it follows the dispatched op's verb (a mutation reaches the circle).
 *
 * @param {object} [args]
 * @param {string} [args.verb]   the dispatched op's verb
 * @param {boolean}[args.error]  the reply carried an error / didn't act
 */
export function scopeForReply({ verb, error } = {}) {
  if (error) return 'self';
  return scopeForVerb(verb);
}
