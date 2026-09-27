/**
 * contactCard — the wire form of a contact card (the body of `onderling-contact://…` and of a `#contact=` link).
 *
 * The card is what a person hands out to be added: their id, keys, name, and where they can be written to. It
 * travels in a QR, so its LENGTH is what a phone camera has to read. It used to be base64url JSON, and most of it
 * was keys that are themselves base64url strings — every key encoded twice — plus empty fields written out and the
 * address repeating the id. A friend's camera could not read the result (Frits, 2026-09-26).
 *
 * The body is now base64url over binary FIELDS:
 *
 *   byte 0          format version (1)
 *   then fields     [tag: 1 byte][length: LEB128][value bytes]
 *
 * A tag's low 7 bits name the field; the high bit says the value is the RAW bytes of a base64url string (a key, an
 * id), which the reader encodes back. Any string that survives the round trip exactly is packed that way, so a key
 * costs its 32 bytes, not 58 characters. Absent and null fields are not written. `trustOffer` is written only when
 * it is not the default. What the named fields cannot hold (an unknown field, an unusual person-key shape) rides a
 * JSON field, so the reader always gives back exactly the card that went in.
 *
 * One codec for the writer (stoop's `getContactShareQr`) and every reader (stoop's `addContactFromQr`, basis's
 * card checks). Pure, and free of platform APIs, so a browser, Node and the phone's JS engine agree.
 */

const VERSION = 1;
const RAW = 0x80;
const DEFAULT_TRUST = 'bekend';

// field ids — part of the wire format: never renumber, only add
const F = Object.freeze({
  webid: 1, pubKey: 2, stableId: 3, handle: 4, displayName: 5, avatarUrl: 6, trustOffer: 7,
  peerAddr: 8, peerAddrIsWebid: 9, relay: 10, pkVersion: 11, pkPubKey: 12, pkLinkKeyPub: 13,
  personKeyLinks: 14, rest: 15,
});
const PLAIN = ['webid', 'pubKey', 'stableId', 'handle', 'displayName', 'avatarUrl'];
const PK_KEYS = ['version', 'pubKey', 'linkKeyPub'];

/**
 * @param {object} card  the card (`webid` required by readers)
 * @returns {string} the base64url body
 */
export function encodeContactCard(card) {
  const c = card && typeof card === 'object' ? card : {};
  const out = [VERSION];
  const field = (id, str) => {
    if (typeof str !== 'string') return;
    const raw = rawOf(str);
    const bytes = raw ?? utf8Encode(str);
    out.push(raw ? (id | RAW) : id, ...leb(bytes.length), ...bytes);
  };
  for (const k of PLAIN) if (c[k] != null) field(F[k], String(c[k]));
  if (c.trustOffer != null && c.trustOffer !== DEFAULT_TRUST) field(F.trustOffer, String(c.trustOffer));
  if (c.peerAddr != null) {
    if (c.peerAddr === c.webid) out.push(F.peerAddrIsWebid, 0);
    else field(F.peerAddr, String(c.peerAddr));
  }
  const relays = Array.isArray(c.relays) ? c.relays : null;
  if (relays) for (const r of relays) field(F.relay, String(r));

  const rest = {};
  const pk = c.personKey;
  const pkPacks = pk && typeof pk === 'object' && !Array.isArray(pk)
    && Object.keys(pk).every((k) => PK_KEYS.includes(k))
    && Number.isSafeInteger(pk.version) && typeof pk.pubKey === 'string' && typeof pk.linkKeyPub === 'string';
  if (pkPacks) {
    field(F.pkVersion, String(pk.version));
    field(F.pkPubKey, pk.pubKey);
    field(F.pkLinkKeyPub, pk.linkKeyPub);
  } else if (pk != null) rest.personKey = pk;
  if (c.personKeyLinks != null) field(F.personKeyLinks, JSON.stringify(c.personKeyLinks));
  if (relays === null && c.relays != null) rest.relays = c.relays;
  const known = new Set([...PLAIN, 'trustOffer', 'peerAddr', 'relays', 'personKey', 'personKeyLinks']);
  for (const [k, v] of Object.entries(c)) if (!known.has(k) && v != null) rest[k] = v;
  if (Object.keys(rest).length) field(F.rest, JSON.stringify(rest));
  return b64urlEncode(out);
}

/**
 * @param {string} body  the base64url body
 * @returns {object|null} the card, or null when the body is not a card (or names no `webid`)
 */
export function decodeContactCard(body) {
  if (typeof body !== 'string' || !body || !/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const bytes = b64urlDecode(body);
  if (!bytes || bytes[0] !== VERSION) return null;
  const card = {};
  const pk = {};
  let i = 1;
  try {
    while (i < bytes.length) {
      const tag = bytes[i++];
      const [len, next] = unleb(bytes, i);
      i = next;
      if (i + len > bytes.length) return null;
      const val = bytes.slice(i, i + len);
      i += len;
      const id = tag & ~RAW;
      const str = (tag & RAW) ? b64urlEncode(val) : utf8Decode(val);
      const name = PLAIN.find((k) => F[k] === id);
      if (name) card[name] = str;
      else if (id === F.trustOffer) card.trustOffer = str;
      else if (id === F.peerAddr) card.peerAddr = str;
      else if (id === F.peerAddrIsWebid) card.peerAddr = true;   // resolved once the webid is known
      else if (id === F.relay) (card.relays ??= []).push(str);
      else if (id === F.pkVersion) pk.version = Number(str);
      else if (id === F.pkPubKey) pk.pubKey = str;
      else if (id === F.pkLinkKeyPub) pk.linkKeyPub = str;
      else if (id === F.personKeyLinks) card.personKeyLinks = JSON.parse(str);
      else if (id === F.rest) Object.assign(card, JSON.parse(str));
      // an unknown field id is skipped: a newer writer's addition, not a broken card
    }
  } catch { return null; }
  if (typeof card.webid !== 'string' || !card.webid) return null;
  if (card.peerAddr === true) card.peerAddr = card.webid;
  if (Object.keys(pk).length) card.personKey = pk;
  card.trustOffer ??= DEFAULT_TRUST;
  return card;
}

// ── bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = Object.fromEntries([...ALPHA].map((ch, n) => [ch, n]));

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += ALPHA[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += ALPHA[n & 63];
  }
  return s;
}

function b64urlDecode(s) {
  if (s.length % 4 === 1) return null;
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < s.length ? INDEX[s[i + k]] : undefined));
    if (c[0] === undefined || c[1] === undefined) return null;
    const n = (c[0] << 18) | (c[1] << 12) | ((c[2] ?? 0) << 6) | (c[3] ?? 0);
    out.push((n >> 16) & 255);
    if (c[2] !== undefined) out.push((n >> 8) & 255);
    if (c[3] !== undefined) out.push(n & 255);
  }
  return out;
}

/** The raw bytes of a base64url string, when the string is exactly their encoding; else null. */
function rawOf(str) {
  if (str.length < 8 || !/^[A-Za-z0-9_-]+$/.test(str)) return null;
  const bytes = b64urlDecode(str);
  return bytes && b64urlEncode(bytes) === str ? bytes : null;
}

function leb(n) {
  const out = [];
  do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n);
  return out;
}

function unleb(bytes, i) {
  let n = 0; let shift = 0;
  for (;;) {
    if (i >= bytes.length || shift > 28) throw new Error('bad length');
    const b = bytes[i++];
    n |= (b & 127) << shift;
    if (!(b & 128)) return [n, i];
    shift += 7;
  }
}

function utf8Encode(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

function utf8Decode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let cp;
    if (b < 0x80) cp = b;
    else if (b >= 0xf0) cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else if (b >= 0xe0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else cp = ((b & 31) << 6) | (bytes[i++] & 63);
    s += String.fromCodePoint(cp);
  }
  return s;
}
