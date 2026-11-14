/**
 * WHO MAY WRITE TO THIS PERSONA FIRST: the two controls on a persona's card in Mij (decision 2026-11-12: the persona is
 * the policy). Both are the persona's own profile properties, read through the registry's readers (so their defaults
 * live in one place: a person requests, a function profile is open; circle members may write unless turned off) and
 * written through the waist op the agent's own setters use: `agents.setProfileProperty` on that persona.
 * One shape both shells paint: a label and its choices, each choice saying what it does.
 */
import { FIRST_MESSAGES_KEY, CIRCLE_MEMBERS_KEY, firstMessagesOf, circleMembersMayWriteOf } from '@onderling/agent-registry';

export const FIRST_CONTACT_CONTROLS = Object.freeze([
  Object.freeze({
    key: FIRST_MESSAGES_KEY,
    labelKey: 'circle.mij.first_messages',
    read: firstMessagesOf,
    choices: Object.freeze([
      Object.freeze({ value: 'request', labelKey: 'circle.mij.first_messages_request' }),
      Object.freeze({ value: 'open',    labelKey: 'circle.mij.first_messages_open' }),
    ]),
  }),
  Object.freeze({
    key: CIRCLE_MEMBERS_KEY,
    labelKey: 'circle.mij.circle_members',
    read: circleMembersMayWriteOf,
    choices: Object.freeze([
      Object.freeze({ value: true,  labelKey: 'circle.mij.circle_members_on' }),
      Object.freeze({ value: false, labelKey: 'circle.mij.circle_members_off' }),
    ]),
  }),
]);

/**
 * A persona's two rows, with the value in force (its own, else the registry's default).
 * @param {{properties?: object, kind?: string|null}} persona  a registry-shaped entry (`properties` as stored)
 * @returns {Array<{key: string, labelKey: string, choices: Array<{value: any, labelKey: string}>, value: any}>}
 */
export function firstContactRows(persona = {}) {
  const entry = { properties: persona?.properties ?? {}, kind: persona?.kind ?? null };
  return FIRST_CONTACT_CONTROLS.map(({ key, labelKey, choices, read }) => ({ key, labelKey, choices, value: read(entry) }));
}
