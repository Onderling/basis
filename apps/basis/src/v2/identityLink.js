/**
 * identityLink — a Telegram person's Basis identity, linked to their row on a household bot (`/koppel`).
 *
 * The person's own Basis app OFFERS (their person key — the chat identity, the same on every device of theirs — this
 * bot's address, a nonce), the person pastes that offer into their PRIVATE chat with the bot, and the bot asks there
 * which of three codes their app shows: the same mechanism as a screen's paste route. Only public things travel through
 * Telegram (a key and a nonce); the bot's answer goes to the key in the offer. What the link gives is identity only: a
 * turn signed by that key IS the person's row (their role, threads, reminders, the names setting).
 *
 * Shared by the bot (it reads an offer, words the start link) and the app (it writes the offer, reads the start link).
 */
import { screenCode } from './botScreens.js';

/** The peer-message subtype of the bot's signed statement to the linked app. */
export const IDENTITY_LINK_SUBTYPE = 'identity-link';
/** An offer as the person pastes it. */
export const LINK_OFFER_SCHEME = 'onderling-koppel:';

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));
const randomNonce = () => { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };

/** The code the app shows and the bot asks for: the fingerprint of the key and the nonce (the screen's derivation). */
export const linkCode = (personKey, nonce) => screenCode(personKey, nonce);

/** The app's offer: its person key, the bot it is for, a fresh nonce. */
export function encodeLinkOffer({ personKey, botAddress, nonce = randomNonce() } = {}) {
  if (typeof personKey !== 'string' || !personKey) throw new Error('encodeLinkOffer: personKey required');
  if (typeof botAddress !== 'string' || !botAddress) throw new Error('encodeLinkOffer: botAddress required');
  return { offer: LINK_OFFER_SCHEME + b64url(JSON.stringify({ v: 1, k: personKey, b: botAddress, n: nonce })), nonce };
}

/** Read an offer (deny-safe: a reason, never half an offer). */
export function parseLinkOffer(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(LINK_OFFER_SCHEME)) return { ok: false, reason: 'not-an-offer' };
  let d; try { d = JSON.parse(unb64url(t.slice(LINK_OFFER_SCHEME.length))); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1) return { ok: false, reason: 'wrong-version' };
  if (typeof d.k !== 'string' || !d.k || typeof d.b !== 'string' || !d.b || typeof d.n !== 'string' || !d.n) return { ok: false, reason: 'incomplete' };
  return { ok: true, personKey: d.k, botAddress: d.b, nonce: d.n };
}

/** The link the bot sends for the app to open (`#koppel-bot=`): which bot, its relay, its name — no secret. */
export function encodeLinkStartLink(appUrl, { botAddress, relayUrl = null, botName = null }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), ...(botName ? { m: botName } : {}) }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#koppel-bot=${body}`;
}

/** Read the start link (the app's address bar). */
export function parseLinkStartLink(link) {
  const m = /#koppel-bot=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null };
}
