/**
 * WHY AN INVITE WAS REFUSED, as it crosses the wire from the inviter's device to the joiner's: a CODE from one closed
 * set, never the text of an exception (which can carry paths, internal state, or wording only the inviter's build
 * knows). The inviter sends `inviteRefusalOf(whatever its substrate said)`; the joiner reads the code through the same
 * function (the wire is not trusted to stay inside the set) and says it in words through `inviteRefusalKey`.
 *
 * One table, both sides: the redeem handler (`core/handlers/groupRedeem.js`) and the join wizard's state
 * (`core/wizards/joinGroupState.js`).
 */

/** code → the sentence the joiner reads (a locale key). The last is the catch-all for any refusal not named here. */
const KEYS = Object.freeze({
  'invalid-or-expired-code':         'circle.invite.expired_code',
  'invite-redemption-limit-reached': 'circle.invite.limit_reached',
  'removed-from-circle':             'circle.invite.removed_from_circle',
  'handle-taken':                    'circle.errors.invalid_handle.handle-taken',
  'rules-acceptance-required':       'circle.errors.rules_acceptance_required',
  'join-refused':                    'circle.invite.join_refused',
});

/** The closed set of refusal codes an inviter may send back. */
export const INVITE_REFUSALS = Object.freeze(Object.keys(KEYS));

/** The code for a refusal: itself when it is one of the set, else the catch-all `join-refused`. */
export function inviteRefusalOf(error) {
  return typeof error === 'string' && Object.prototype.hasOwnProperty.call(KEYS, error) ? error : 'join-refused';
}

/** The locale key the joiner shows for a refusal code (an unknown code reads as the catch-all). */
export function inviteRefusalKey(code) {
  return KEYS[inviteRefusalOf(code)];
}
