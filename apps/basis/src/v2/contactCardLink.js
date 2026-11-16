/**
 * contactCardLink — the clickable form of a contact card.
 *
 * A contact card is the `onderling-contact://<base64url>` payload pinboard's `getContactShareQr` makes: the person's
 * webid, key, handle/name, the address they are written to, their relay. A QR is one way to hand it over; a LINK
 * is the other (Frits 2026-09-19: "simply link to the website, including the contact"). The card rides the URL's
 * FRAGMENT — `https://onderling.org/basis/#contact=<payload>` — as the add-a-device offer does: a fragment never
 * leaves the browser, so the card is in no server log, and the app that opens the link finds it in `location.hash`.
 *
 * Both shells use these; the web boot reads the hash, mobile's deep link the same string.
 */

import { decodeContactCard as decodeCardBody } from '@onderling-app/pinboard/lib/contactCard';

export const CONTACT_SCHEME = 'onderling-contact://';
export const CONTACT_LINK_PARAM = 'contact';
/**
 * The one-time token a SHARED link carries beside the card (L806, Frits 2026-11-12): every "Share my contact" mints one
 * for the persona shared as (pinboard's `mintSharedCard`); the first turn that carries it is let on as if chosen, anyone
 * after is a request. It rides the fragment with the card, so no server sees it; the raw code carries none.
 */
export const SHARED_LINK_TOKEN_PARAM = 't';

/**
 * How the contact QR is DRAWN, one answer for both shells (their QR libraries differ; the settings do not). A card
 * link is several hundred characters, so the code is dense and a phone camera is the test it must pass
 * (Frits 2026-09-26: a friend's camera could not read it). Level L gives the most room per module, since a screen
 * is not a torn label; the quiet zone is the four modules the QR standard asks for (the panel drew one, and
 * cameras look for the white border to find the code); `size` is the resting side in CSS px / DIPs, and a tap
 * enlarges it.
 */
export const CONTACT_QR = Object.freeze({ errorCorrectionLevel: 'L', quietZoneModules: 4, size: 280 });
const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The link for a card, on the app served at `appUrl`.
 * @param {string} appUrl   where the app is served (origin + path, a query is kept, a fragment replaced)
 * @param {string} payload  the `onderling-contact://…` card
 * @param {string|null} [token] the shared link's one-time token (base64url), or none
 * @returns {{ok:true, link:string}|{ok:false, reason:string}}
 */
export function contactCardLink(appUrl, payload, token = null) {
  const body = bodyOf(payload);
  if (!body) return { ok: false, reason: 'not-a-contact-card' };
  if (typeof appUrl !== 'string' || !/^https?:\/\//.test(appUrl)) return { ok: false, reason: 'bad-app-url' };
  const tok = typeof token === 'string' && B64URL.test(token) ? `&${SHARED_LINK_TOKEN_PARAM}=${token}` : '';
  return { ok: true, link: `${appUrl.split('#')[0]}#${CONTACT_LINK_PARAM}=${body}${tok}` };
}

/**
 * The card from a link — or from a bare hash, or the raw code (one paste box takes anything) — and the shared link's
 * token when the link carries a well-formed one.
 * @param {string} hrefOrHash
 * @returns {{ok:true, payload:string, token?:string}|{ok:false, reason:string}}
 */
export function contactCardFromLink(hrefOrHash) {
  if (typeof hrefOrHash !== 'string' || !hrefOrHash.trim()) return { ok: false, reason: 'not-a-contact-link' };
  const s = hrefOrHash.trim();
  if (s.startsWith(CONTACT_SCHEME)) return bodyOf(s) ? { ok: true, payload: s } : { ok: false, reason: 'not-a-contact-card' };
  const hashIdx = s.indexOf('#');
  const hash = hashIdx >= 0 ? s.slice(hashIdx + 1) : s;
  const m = new RegExp(`(?:^|&)${CONTACT_LINK_PARAM}=([^&]+)`).exec(hash);
  if (!m || !B64URL.test(m[1])) return { ok: false, reason: 'not-a-contact-link' };
  const tok = new RegExp(`(?:^|&)${SHARED_LINK_TOKEN_PARAM}=([^&]+)`).exec(hash);
  return { ok: true, payload: CONTACT_SCHEME + m[1], ...(tok && B64URL.test(tok[1]) ? { token: tok[1] } : {}) };
}

function bodyOf(payload) {
  if (typeof payload !== 'string') return null;
  const s = payload.trim();
  if (!s.startsWith(CONTACT_SCHEME)) return null;
  const body = s.slice(CONTACT_SCHEME.length);
  return B64URL.test(body) ? body : null;
}

/**
 * What the "share my contact" panel shows, resolved once for both shells: the card pinboard makes, its link form, and
 * what the QR encodes. A shell paints; it decides nothing. No card (no identity yet) ⇒ `payload: null`; no http(s)
 * app url (a dev shell, a native build without `EXPO_PUBLIC_WEB_APP_URL`) ⇒ `link: null` — the QR and the code
 * still stand.
 *
 * THE QR IS THE LINK when there is one (Frits 2026-09-21): a phone's camera does nothing with `onderling-contact://…`
 * but opens an https link in the browser, where the app adds the contact — the invite QR has always worked that
 * way. The in-app scanner reads both forms, so a QR of the link scans in the app too. Without a link the QR is the
 * raw code, which only the in-app scanner reads.
 *
 * EVERY SHOWING MINTS A NEW LINK (L806, Frits 2026-11-12): the link carries a fresh one-time token for the persona shared
 * as, so its first opener is let on as if chosen; anyone after is a request. Only a link carries it (the code is the bare
 * card), so without a link nothing is minted; a mint that fails leaves the plain link (its opener is a request).
 * @param {{ callSkill: (app: string, op: string, args: object) => Promise<any>, appUrl?: string|null }} a
 * @returns {Promise<{ payload: string|null, link: string|null, qr: string|null, qrEncodes: 'link'|'code'|null, token: string|null }>}
 */
export async function loadShareMyContact({ callSkill, appUrl = null } = {}) {
  let payload = null;
  try { payload = (await callSkill('pinboard', 'getContactShareQr', {}))?.payload ?? null; } catch { payload = null; }
  if (typeof payload !== 'string' || !payload) return { payload: null, link: null, qr: null, qrEncodes: null, token: null };
  const plain = appUrl ? contactCardLink(appUrl, payload) : { ok: false };
  let token = null;
  if (plain.ok) {
    try {
      const minted = await callSkill('pinboard', 'mintSharedCard', {});
      token = typeof minted?.token === 'string' && B64URL.test(minted.token) ? minted.token : null;
    } catch { token = null; }
  }
  const link = plain.ok ? contactCardLink(appUrl, payload, token).link : null;
  return { payload, link, qr: link ?? payload, qrEncodes: link ? 'link' : 'code', token };
}

/**
 * The state of the link the panel shows, for both shells to say: not used yet, used (when), or gone (withdrawn, expired,
 * or not yet carried to this device). Read from pinboard's `listSharedCards`.
 * @param {{ callSkill: Function, token: string|null }} a
 * @returns {Promise<{ state: 'unused'|'used'|'gone', usedAt: number|null }>}
 */
export async function sharedLinkState({ callSkill, token } = {}) {
  if (typeof token !== 'string' || !token) return { state: 'gone', usedAt: null };
  let links = [];
  try { links = (await callSkill('pinboard', 'listSharedCards', {}))?.links ?? []; } catch { links = []; }
  const l = Array.isArray(links) ? links.find((x) => x?.token === token) : null;
  if (!l) return { state: 'gone', usedAt: null };
  return l.state === 'used' ? { state: 'used', usedAt: Number.isFinite(l.usedAt) ? l.usedAt : null } : { state: 'unused', usedAt: null };
}

/**
 * The link's state in words, one answer for both shells: "Not used yet", "Used on 14 Nov", or null (nothing to say).
 * @param {{ state: string, usedAt: number|null }} st
 * @param {{ t: (k: string, v?: object) => string, lang?: string, tz?: string }} opts
 */
export function sharedLinkWords(st, { t, lang = 'nl', tz } = {}) {
  if (st?.state === 'unused') return t('circle.shareContact.link_unused');
  if (st?.state !== 'used') return null;
  const date = Number.isFinite(st.usedAt)
    ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) }).format(new Date(st.usedAt))
    : '';
  return t('circle.shareContact.link_used', { date });
}

/** Withdraw the link the panel shows ("Withdraw this link"): its later opener is a request. */
export async function withdrawSharedLink({ callSkill, token } = {}) {
  if (typeof token !== 'string' || !token) return false;
  try { return (await callSkill('pinboard', 'withdrawSharedCard', { token }))?.withdrawn === true; } catch { return false; }
}

/**
 * The card's body, decoded — `{ webid, pubKey, handle, displayName, peerAddr, relays, personKey, … }` — or null. The
 * one decoder outside pinboard for the one place that must READ a card before handing it to pinboard: a card that arrives
 * in a message must name the sender (below), or a stranger could put anyone's name on their own address.
 * @param {string} payload  `onderling-contact://<body>` — the body is pinboard's contact-card codec
 */
export function decodeContactCard(payload) {
  const body = bodyOf(payload);
  return body ? decodeCardBody(body) : null;
}

/**
 * A CARD THAT RIDES A MESSAGE IS ONLY TAKEN WHEN IT NAMES THE SENDER (2026-09-21). The first message to a contact
 * carries the sender's card so the receiver knows who wrote (name, handle, where to write back, the person key) —
 * the exchange Frits expected of a first contact. A card is self-described, so the receiver checks it against what
 * it can verify: the identity behind the address the message came from (the shell's `identityOf`: the profile
 * address itself, or the person behind a per-circle address). A card naming anyone else is dropped.
 * @param {string} payload    the card
 * @param {string} contactId  the person the message is from, as the receiver resolved it
 * @returns {object|null}     the decoded card when it names `contactId`, else null
 */
export function cardNamesSender(payload, contactId) {
  const card = decodeContactCard(payload);
  if (!card || typeof contactId !== 'string' || !contactId) return null;
  return (card.webid === contactId || card.peerAddr === contactId) ? card : null;
}
