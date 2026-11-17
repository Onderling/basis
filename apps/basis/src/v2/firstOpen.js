/**
 * THE FIRST OPEN — three doors, the first time the app opens on a device: scan a code someone gave you, read the
 * introduction, or just continue to Today (where "New to Basis?" stays as the reminder until the intro is seen). One
 * model both shells paint: the phone on its welcome screen (before the first boot), web on a screen before Today.
 *
 * A door is a choice, not an act of its own: scan runs the one scanner (the `scanQr` op, as Me's "Scan" does), the
 * introduction opens the seven cards (introDeck.js), continue shows Today. Choosing any door ends the first open on this
 * device; nothing is asked twice.
 */

import { contactCardFromLink } from './contactCardLink.js';
import { enrollOfferFromLink } from './enrollOffer.js';
import { parseLinkStartLink } from './identityLink.js';

/** The doors, in the order they are shown; `continue` is the plain way on and comes last. */
export const FIRST_OPEN_DOORS = Object.freeze([
  Object.freeze({ id: 'scan', labelKey: 'circle.firstOpen.scan', primary: false }),
  Object.freeze({ id: 'intro', labelKey: 'circle.firstOpen.intro', primary: true }),
  Object.freeze({ id: 'continue', labelKey: 'circle.firstOpen.continue', primary: false }),
]);

/** The screen's words above the doors: the welcome's own title, then one line on what the doors are for. */
export const FIRST_OPEN_WORDS = Object.freeze({ titleKey: 'circle.firstRun.title', leadKey: 'circle.firstOpen.lead' });

/**
 * Whether the address the app was opened with carries something the app acts on: a contact card, a circle invitation,
 * an enrol offer, an extension install, a bot to add or a bot's link start. Arriving with one IS the scan door, already
 * answered: the host marks the first open seen and goes on with the link, no doors. Read from the address AS IT WAS AT
 * BOOT (the hosts scrub a link from the bar once they take it). Each kind is read by its own parser, never by a pattern
 * here, so a link the app does not act on (a stray `#x`) still gets the doors.
 * @param {{ hash?: string, search?: string }} address
 * @returns {boolean}
 */
export function addressCarriesAct({ hash = '', search = '' } = {}) {
  const h = String(hash ?? '');
  if (contactCardFromLink(h).ok || enrollOfferFromLink(h).ok || parseLinkStartLink(h).ok) return true;
  let params = null;
  try { params = new URLSearchParams(String(search ?? '')); } catch { params = null; }
  return !!params && ['join', 'install', 'addbot'].some((k) => !!params.get(k));
}

/**
 * What a host does once the app is on Today after a door: run the scanner, open the introduction, or nothing.
 * @param {string} door
 * @returns {'scan'|'intro'|null}
 */
export function firstOpenThen(door) {
  return door === 'scan' || door === 'intro' ? door : null;
}
