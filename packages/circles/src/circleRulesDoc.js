/**
 * The HUMAN rules doc — the one definition of "does this circle have rules a joiner accepts?"
 * (task #80). A circle's `group-rules` blob always exists because it carries OPERATIONAL settings
 * (key rotation, storage policy, invite ceilings); the HUMAN rules are the seven consent-screen
 * fields the create wizard writes flat onto it and the join wizard shows before the tick. Rules-gated
 * admission keys on THESE — a circle whose rules doc is operational-only has nothing to accept and
 * admits exactly as before.
 *
 * One home (this substrate), imported DOWNWARD by both consumers: the membership writers' admission
 * refusal here in @onderling/circles, and the join wizard's consent extractor + the roster fold gate
 * in the apps. Two lists of these fields would be exactly the vocabulary drift the repo's rules warn
 * about (deliveryState is the cautionary twin).
 */
export const HUMAN_RULES_FIELDS = Object.freeze([
  'purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility',
]);

/** True when the rules blob carries at least one non-blank human rules field. */
export function hasHumanRules(rules) {
  if (!rules || typeof rules !== 'object') return false;
  return HUMAN_RULES_FIELDS.some((k) => typeof rules[k] === 'string' && rules[k].trim() !== '');
}
