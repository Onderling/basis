/**
 * The feedback contact — writing to Onderling about the app. The build carries a contact card (the alpha's feedback
 * persona on an always-on device, seeded into every fresh install; `seededContact.js`); the feedback door opens that
 * contact's thread with a short prefill naming the screen and the build, and the person writes and sends it
 * themselves. Nothing is collected or sent on its own: no device id, no log, no auto-send. On a bot door (Telegram)
 * the person has no app contact, so the bot answers with the card's link to add — nothing is forwarded.
 *
 * Pure — each shell hands in its card, its version, the screen it is on and its app address.
 */
import { seededContactWebid } from './seededContact.js';
import { contactCardLink } from './contactCardLink.js';

// A shell's screen state → the one id both shells say. Ids, not words: the prefill goes to the maker's contact.
const SCREEN_IDS = {
  screens: 'vandaag', circles: 'kringen', list: 'kringen', profile: 'mij', mij: 'mij',
  contacten: 'contacten', nearby: 'nearby', settingsHome: 'instellingen', settingsGroup: 'instellingen',
};
const CODE_ID = /^[a-z][A-Za-z0-9-]{0,40}$/;

/**
 * The KIND of screen the person is on, for the prefill: never what is on it. Inside a circle it is "circle" and never
 * the circle's name (the person's own); a settings group adds its group id; anything that is not a plain code id is
 * dropped rather than echoed.
 *
 * @param {{inCircle?: boolean, screen?: string|null, settingsGroup?: string|null}} [state]
 * @returns {string}
 */
export function feedbackScreenId({ inCircle = false, screen = null, settingsGroup = null } = {}) {
  if (inCircle) return 'circle';
  const s = typeof screen === 'string' ? screen : '';
  const id = SCREEN_IDS[s] ?? (CODE_ID.test(s) ? s : '');
  if (s === 'settingsGroup' && typeof settingsGroup === 'string' && CODE_ID.test(settingsGroup)) return `${id}/${settingsGroup}`;
  return id;
}

/** The prefill: "[<screen> · <version>] " and nothing else. */
export function feedbackDraft({ screen = '', version = '' } = {}) {
  const where = String(screen ?? '').trim() || '?';
  const build = String(version ?? '').trim() || 'dev';
  return `[${where} · ${build}] `;
}

/** The feedback contact's webid: the build's card's person, or null when the build carries no (readable) card. */
export function feedbackTarget(card) {
  return seededContactWebid(typeof card === 'string' ? card.trim() : null);
}

/** The card's link on the app's own address (for a bot door), or null when there is no card or no app address. */
export function feedbackLink({ card, appUrl } = {}) {
  if (typeof card !== 'string' || !card.trim()) return null;
  const r = contactCardLink(appUrl, card.trim());
  return r.ok ? r.link : null;
}
