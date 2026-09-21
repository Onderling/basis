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

/**
 * What the "share my contact" panel shows, resolved once for both shells: the card stoop makes, its link form, and
 * what the QR encodes. A shell paints; it decides nothing. No card (no identity yet) ⇒ `payload: null`; no http(s)
 * app url (a dev shell, a native build without `EXPO_PUBLIC_WEB_APP_URL`) ⇒ `link: null` — the QR and the code
 * still stand.
 *
 * THE QR IS THE LINK when there is one (Frits 2026-09-21): a phone's camera does nothing with `onderling-contact://…`
 * but opens an https link in the browser, where the app adds the contact — the invite QR has always worked that
 * way. The in-app scanner reads both forms, so a QR of the link scans in the app too. Without a link the QR is the
 * raw code, which only the in-app scanner reads.
 * @param {{ callSkill: (app: string, op: string, args: object) => Promise<any>, appUrl?: string|null }} a
 * @returns {Promise<{ payload: string|null, link: string|null, qr: string|null, qrEncodes: 'link'|'code'|null }>}
 */
export async function loadShareMyContact({ callSkill, appUrl = null } = {}) {
  let payload = null;
  try { payload = (await callSkill('stoop', 'getContactShareQr', {}))?.payload ?? null; } catch { payload = null; }
  if (typeof payload !== 'string' || !payload) return { payload: null, link: null, qr: null, qrEncodes: null };
  const linkR = appUrl ? contactCardLink(appUrl, payload) : { ok: false };
  const link = linkR.ok ? linkR.link : null;
  return { payload, link, qr: link ?? payload, qrEncodes: link ? 'link' : 'code' };
}
