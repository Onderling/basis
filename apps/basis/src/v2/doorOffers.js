/**
 * doorOffers — an offer pasted ALONE in a chat with the bot: a screen's connect code (`onderling-connect://…`) or a Basis
 * app's identity-link offer (`onderling-koppel:…`). A person copies what the page shows and sends it; the door reads a
 * line that is nothing but such an offer as its command (`/koppel-scherm`, `/koppel`), so the command word is not a
 * second thing to get right. The command's own checks are unchanged (a private chat, the code picked from three).
 */
import { CONNECT_SCHEME } from './connectionPairing.js';
import { LINK_OFFER_SCHEME } from './identityLink.js';

const BARE = Object.freeze([
  { scheme: CONNECT_SCHEME, command: '/koppel-scherm' },
  { scheme: LINK_OFFER_SCHEME, command: '/koppel' },
]);

/**
 * The command a bare offer stands for, or null when the line is anything else.
 * @param {string} text
 * @returns {string|null}
 */
export function commandForBareOffer(text) {
  const line = String(text ?? '').trim();
  if (!line || /\s/.test(line)) return null;
  const hit = BARE.find((b) => line.startsWith(b.scheme) && line.length > b.scheme.length);
  return hit ? `${hit.command} ${line}` : null;
}
