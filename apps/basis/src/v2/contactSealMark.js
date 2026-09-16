/**
 * What a direct message to a contact is sealed to — as the thread header says it, on both shells.
 *
 * The truth is the agent's (`contactSeal.statusFor(webid)`: the same resolution the seal itself uses — my current
 * person key AND the contact's known key → sealed to the PERSON; otherwise the turn goes sealed to the device only,
 * as before). This module only projects that status onto the one locale key each shell paints; nothing here decides.
 */
export const CONTACT_SEAL_LEVEL = Object.freeze({ PERSON: 'person', DEVICE: 'device' });

const KEY = Object.freeze({
  [CONTACT_SEAL_LEVEL.PERSON]: 'circle.contacts.sealed_person',
  [CONTACT_SEAL_LEVEL.DEVICE]: 'circle.contacts.sealed_device',
});

/**
 * @param {{ sealed?: string } | null | undefined} status  the agent's `contactSeal.statusFor(webid)` result
 * @returns {{ level: 'person'|'device', key: string }}   the level and the locale key to paint
 */
export function contactSealMark(status) {
  const level = status?.sealed === CONTACT_SEAL_LEVEL.PERSON ? CONTACT_SEAL_LEVEL.PERSON : CONTACT_SEAL_LEVEL.DEVICE;
  return { level, key: KEY[level] };
}
