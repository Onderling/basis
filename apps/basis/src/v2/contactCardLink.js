/**
 * contactCardLink — the clickable form of a contact card.
 *
 * A contact card is the `onderling-contact://<base64url>` payload stoop's `getContactShareQr` makes: the person's
 * webid, key, handle/name, the address they are written to, their relay. A QR is one way to hand it over; a LINK
 * is the other (Frits 2026-09-19: "simply link to the website, including the contact"). The card rides the URL's
 * FRAGMENT — `https://onderling.org/basis/#contact=<payload>` — as the add-a-device offer does: a fragment never
 * leaves the browser, so the card is in no server log, and the app that opens the link finds it in `location.hash`.
 *
 * Both shells use these; the web boot reads the hash, mobile's deep link the same string.
 */

export const CONTACT_SCHEME = 'onderling-contact://';
export const CONTACT_LINK_PARAM = 'contact';
const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The link for a card, on the app served at `appUrl`.
 * @param {string} appUrl   where the app is served (origin + path, a query is kept, a fragment replaced)
 * @param {string} payload  the `onderling-contact://…` card
 * @returns {{ok:true, link:string}|{ok:false, reason:string}}
 */
export function contactCardLink(appUrl, payload) {
  const body = bodyOf(payload);
  if (!body) return { ok: false, reason: 'not-a-contact-card' };
  if (typeof appUrl !== 'string' || !/^https?:\/\//.test(appUrl)) return { ok: false, reason: 'bad-app-url' };
  return { ok: true, link: `${appUrl.split('#')[0]}#${CONTACT_LINK_PARAM}=${body}` };
}

/**
 * The card from a link — or from a bare hash, or the raw code (one paste box takes anything).
 * @param {string} hrefOrHash
 * @returns {{ok:true, payload:string}|{ok:false, reason:string}}
 */
export function contactCardFromLink(hrefOrHash) {
  if (typeof hrefOrHash !== 'string' || !hrefOrHash.trim()) return { ok: false, reason: 'not-a-contact-link' };
  const s = hrefOrHash.trim();
  if (s.startsWith(CONTACT_SCHEME)) return bodyOf(s) ? { ok: true, payload: s } : { ok: false, reason: 'not-a-contact-card' };
  const hashIdx = s.indexOf('#');
  const hash = hashIdx >= 0 ? s.slice(hashIdx + 1) : s;
  const m = new RegExp(`(?:^|&)${CONTACT_LINK_PARAM}=([^&]+)`).exec(hash);
  if (!m || !B64URL.test(m[1])) return { ok: false, reason: 'not-a-contact-link' };
  return { ok: true, payload: CONTACT_SCHEME + m[1] };
}

function bodyOf(payload) {
  if (typeof payload !== 'string') return null;
  const s = payload.trim();
  if (!s.startsWith(CONTACT_SCHEME)) return null;
  const body = s.slice(CONTACT_SCHEME.length);
  return B64URL.test(body) ? body : null;
}
