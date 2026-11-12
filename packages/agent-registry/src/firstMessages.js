/**
 * WHO MAY WRITE TO THIS PERSONA FIRST (Frits 2026-11-12: "the persona can be the policy itself"). `request`: a first
 * message from someone the persona did not choose is held as a message request; `open`: anyone may write, within the
 * stranger budgets. Kept as the profile's own property `firstMessages`, so it is one of the profile's FACTS and reaches
 * every device of the person by the facts carry, and no preset releases it (a preset releases only the keys it lists).
 * Absent: a function profile's is `open` (a bot takes anyone's first word, its own door admits), a person's is
 * `request`. One mechanism for both: a bot is a persona whose door is open.
 */
export const FIRST_MESSAGE_POLICIES = Object.freeze(['request', 'open']);
/** The profile property that holds the policy. */
export const FIRST_MESSAGES_KEY = 'firstMessages';

/** The policy a registry entry stands for: its own property, else what its kind implies. */
export function firstMessagesOf(entry) {
  const own = entry?.properties?.[FIRST_MESSAGES_KEY];
  const v = own && typeof own === 'object' && own.mode === 'own' ? own.value : undefined;
  if (FIRST_MESSAGE_POLICIES.includes(v)) return v;
  return entry?.kind === 'function' ? 'open' : 'request';
}
