/**
 * CONNECTION PAIRING — how a screen that is yours, somewhere else, gets its grant.
 *
 * The chicken-and-egg of pairing is that the grant must reach a view that does not yet have one.
 * This resolves it the way the rest of the system already works, rather than by inventing a side
 * channel: **the view registers its OWN pubkey as its relay address.** It is then reachable before
 * it is trusted — reachable and trusted are different things, and only the second needs a grant.
 *
 * That choice also closes an honest seam left open by the read-half walk: the mirror's re-pull nudge
 * sends to the view's pubkey, which assumed a view is directly addressable. With this flow that
 * assumption is true by construction rather than by luck.
 *
 *   view                                    owner's device
 *   ────                                    ──────────────
 *   generate a keypair
 *   connect to the relay AS that pubkey
 *   show a pairing offer  ───(QR / paste)──▶ parse it, tick what it may SEE and DO
 *                                            grantSurface → tokens
 *                          ◀───(relay)────── deliver the grant to the view's address
 *   check it answers MY offer, store it
 *
 * ── What the offer is, and is not ───────────────────────────────────────────────────────────────
 * It carries a public key, a relay hint, and a nonce. It is NOT a secret and NOT a credential:
 * anyone who intercepts it can only *offer to be granted something*, which is precisely what the
 * owner then refuses or narrows by ticking. The authority flows the other way — from the owner's
 * device, as signed tokens — so a leaked offer costs nothing. What the nonce buys is that a view
 * can tell "this grant answers the offer I just made" from "this is an older grant replayed at me".
 */

/** The scheme. A distinct one from enrolment on purpose: enrolling makes a DEVICE (keys, ceremony,
 *  the recovery phrase); connecting makes a CONNECTION (ticks only). Confusing them at a QR code
 *  would be confusing them at the only moment a person is deciding between them. */
export const CONNECT_SCHEME = 'onderling-connect://';

/** The wire subtype the owner's device answers an offer on. */
export const CONNECTION_GRANT_SUBTYPE = 'surface-grant-offer';

const b64url = {
  encode(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const pad = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  },
};

/**
 * Build the offer a view shows (as a QR, or as text to paste).
 *
 * @param {object} a
 * @param {string} a.viewPubKey     the view's own public key — also the address it listens on
 * @param {string} [a.relayUrl]     where it is listening; omitted → the owner's own relay is assumed
 * @param {string} a.nonce          this offer's id; the grant must echo it
 * @param {string} [a.label]        what the view calls itself ("laptop", "keukentablet")
 * @returns {string} an `onderling-connect://…` URI
 */
export function encodePairingOffer({ viewPubKey, relayUrl = null, nonce, label = null } = {}) {
  if (typeof viewPubKey !== 'string' || !viewPubKey) throw new Error('encodePairingOffer: viewPubKey required');
  if (typeof nonce !== 'string' || !nonce) throw new Error('encodePairingOffer: nonce required');
  return CONNECT_SCHEME + b64url.encode({
    v: 1, k: viewPubKey, ...(relayUrl ? { r: relayUrl } : {}), n: nonce, ...(label ? { l: label } : {}),
  });
}

/**
 * Parse an offer. Deny-safe by construction: every failure returns a REASON rather than a partial
 * object, because a half-understood pairing offer is the kind of thing a UI would happily act on.
 *
 * @param {string} uri
 * @returns {{ok:true, viewPubKey:string, relayUrl:?string, nonce:string, label:?string}
 *          |{ok:false, reason:'not-a-connect-uri'|'unreadable'|'wrong-version'|'incomplete'}}
 */
export function parsePairingOffer(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(CONNECT_SCHEME)) return { ok: false, reason: 'not-a-connect-uri' };
  let body;
  try { body = b64url.decode(uri.slice(CONNECT_SCHEME.length).trim()); }
  catch { return { ok: false, reason: 'unreadable' }; }
  if (!body || typeof body !== 'object') return { ok: false, reason: 'unreadable' };
  if (body.v !== 1) return { ok: false, reason: 'wrong-version' };
  if (typeof body.k !== 'string' || !body.k || typeof body.n !== 'string' || !body.n) {
    return { ok: false, reason: 'incomplete' };
  }
  return {
    ok: true,
    viewPubKey: body.k,
    relayUrl: typeof body.r === 'string' && body.r ? body.r : null,
    nonce: body.n,
    label: typeof body.l === 'string' && body.l ? body.l : null,
  };
}

/**
 * The view's side of the answer: decide whether an inbound grant is really the one it asked for.
 *
 * Three checks, and each rejects a different real mistake:
 *   wrong-nonce    an older grant (or someone else's) replayed at this view
 *   wrong-subject  tokens minted for a DIFFERENT view — useless here, and accepting them would
 *                  leave the view believing it is paired when nothing will verify
 *   no-tokens      an answer carrying nothing to present
 *
 * @param {object} payload   the `surface-grant-offer` payload
 * @param {object} a
 * @param {string} a.nonce        the nonce this view offered
 * @param {string} a.viewPubKey   this view's own key
 * @returns {{ok:true, tokens:object[], issuer:string, label:?string}
 *          |{ok:false, reason:'wrong-nonce'|'wrong-subject'|'no-tokens'}}
 */
export function acceptConnectionGrant(payload, { nonce, viewPubKey } = {}) {
  if (!payload || payload.nonce !== nonce) return { ok: false, reason: 'wrong-nonce' };
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
  if (tokens.length === 0) return { ok: false, reason: 'no-tokens' };
  if (!tokens.every((t) => t && t.subject === viewPubKey)) return { ok: false, reason: 'wrong-subject' };
  return {
    ok: true,
    tokens,
    issuer: tokens[0].issuer,          // the owner's key — how the view learns whose screen it is
    label: payload.label ?? null,
  };
}
