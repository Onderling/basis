/**
 * The help bot as a contact — one projection both Contacten screens and both launchers read.
 *
 * The onboarding conversation lives in the help circle's store (`cc-help`); only its DOOR moves: Contacten shows one
 * synthetic row for the bot, and the launcher stops painting the help circle as a tile. The row is `synthetic` — it
 * is no pair-roster contact, so it has no card, no address and no person-actions; a shell gates every one of those off
 * that flag. Its name is the bot's locale key, never a literal.
 */
import { HELP_CIRCLE_ID, ONDERLING_BOT_WEBID } from './helpCircle.js';

export const HELP_CONTACT_ID = 'help-contact';

/** The contact rows with the help bot first, when the help circle exists on this device. Idempotent. */
export function withHelpContact(rows = [], { t, available = false } = {}) {
  const real = (rows || []).filter((r) => !r?.synthetic);
  if (!available) return real;
  const name = typeof t === 'function' ? t('circle.onboarding.help_name') : 'circle.onboarding.help_name';
  const row = { id: HELP_CONTACT_ID, contactId: ONDERLING_BOT_WEBID, name, isBot: true, synthetic: true, reachable: true, circleId: HELP_CIRCLE_ID };
  return [row, ...real];
}

/** Where a tap on a Contacten row goes: the help circle's conversation for the synthetic row, else the contact's thread. */
export function contactOpenTarget(c) {
  if (c?.synthetic && c.circleId) return { kind: 'circle', circleId: c.circleId };
  return { kind: 'thread', contact: c };
}

/** The circles the launcher paints as tiles: every circle but the help circle (its door is in Contacten). */
export function tileCircles(circles = []) {
  return (circles || []).filter((c) => c?.id !== HELP_CIRCLE_ID);
}
