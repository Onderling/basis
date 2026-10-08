/**
 * identityLink — a Telegram person's Basis identity, linked to their row on a household bot (`/koppel`).
 *
 * The person's own Basis app OFFERS, the person pastes that offer into their PRIVATE chat with the bot, and the bot asks
 * there which of three codes their app shows: the same mechanism as a screen's paste route. Only public things travel
 * through Telegram.
 *
 * WHAT THE OFFER BINDS. Every device of a person holds the profile key (a revoked one too), so the link cannot rest on it:
 * a device the person retired would go on speaking to the bot as them. The offer is a DEVICE STATEMENT instead — the
 * shape a companion claim has (`signDeviceStatement`): signed by this device's delegation key, the root-signed
 * delegation carried beside it, so the bot verifies the chain on its own and learns the person's ROOT. The bot records
 * that root on the person's row; from then on a turn (or a call) is the person's when it carries a statement from a
 * device whose delegation chains to that root and that the root has not revoked. A revoked device's statement is
 * refused, so its turn is a stranger's.
 *
 * The offer also names the person's chat identity (the key their circles know them by) with that key's own signature
 * over the same nonce: the bot keeps it to name the person in the household's circle (the in-app invite, a planned row
 * acting as them). It is never what a turn is accepted by.
 *
 * Shared by the bot (it reads an offer, checks a turn, words the start link) and the app (it writes the offer and the
 * statements over its turns, reads the start link).
 */
import { AgentIdentity, STATEMENT_DOMAINS, verifyDeviceStatement } from '@onderling/core';
import { screenCode } from './botScreens.js';

/** The peer-message subtype of the bot's statement to the linked app (linked, or unlinked). */
export const IDENTITY_LINK_SUBTYPE = 'identity-link';
/** The peer-message subtype of a device's revocation, delivered to a bot the person's identity is linked to. */
export const IDENTITY_LINK_REVOKE_SUBTYPE = 'identity-link-revoke';
/** An offer as the person pastes it. */
export const LINK_OFFER_SCHEME = 'onderling-koppel:';
/** The ops a linked device's statement is made for, at the bot: the link itself, a turn, handing the bot a companion. */
export const LINK_OPS = Object.freeze({ LINK: 'link', TURN: 'turn', COMPANION: 'assistant-companion' });
/** The bot's one op its linked person's app calls directly (not a turn): hand it a companion's card. */
export const LINKED_COMPANION_OP = 'identity-link.companion';

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));

/** The code the app shows and the bot asks for: the fingerprint of the root and the nonce (the screen's derivation). */
export const linkCode = (root, nonce) => screenCode(root, nonce);

/**
 * The text the chat identity's signature covers — the key, the bot, the nonce, domain-separated: proof that the app
 * holds the chat identity it names. The device statement is what links; this only binds the name the person's circles
 * know them by to the same offer.
 */
export const linkOfferMessage = ({ k, b, n }) => `onderling-identity-link:v1:${k}:${b}:${n}`;

/**
 * The app's offer: its device statement for the bot (op `link`, the chat identity as its argument) and the chat
 * identity's own signature over the same nonce. The ROOT it names is the one the statement's delegation is signed by.
 * @param {{statement: object, webid: string, webidSig: string}} a
 * @returns {{offer: string, nonce: string, root: string}}
 */
export function encodeLinkOffer({ statement, webid, webidSig } = {}) {
  const root = statement?.delegation?.by;
  if (!statement || typeof statement.node !== 'string' || typeof statement.nonce !== 'string' || typeof root !== 'string') {
    throw new Error('encodeLinkOffer: a device statement is required');
  }
  if (typeof webid !== 'string' || !webid || typeof webidSig !== 'string' || !webidSig) throw new Error('encodeLinkOffer: the chat identity and its signature are required');
  const body = { v: 2, k: root, w: webid, s: webidSig, st: statement };
  return { offer: LINK_OFFER_SCHEME + b64url(JSON.stringify(body)), nonce: statement.nonce, root };
}

/**
 * Read an offer (deny-safe: a reason, never half an offer). Checked here: its shape, and that the chat identity it names
 * signed it. The device statement's chain is the bot's to verify (`verifyLinkStatement`), against its own address, the
 * root the offer names, its tombstones and the nonces it has seen.
 * @returns {{ok: true, root: string, webid: string, botAddress: string, nonce: string, statement: object} | {ok: false, reason: string}}
 */
export function parseLinkOffer(text, { verify = (message, sig, key) => AgentIdentity.verify(message, sig, key) } = {}) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(LINK_OFFER_SCHEME)) return { ok: false, reason: 'not-an-offer' };
  let d; try { d = JSON.parse(unb64url(t.slice(LINK_OFFER_SCHEME.length))); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 2) return { ok: false, reason: 'wrong-version' };
  const st = d.st;
  if (typeof d.k !== 'string' || !d.k || typeof d.w !== 'string' || !d.w || !st || typeof st !== 'object'
    || typeof st.node !== 'string' || !st.node || typeof st.nonce !== 'string' || !st.nonce) return { ok: false, reason: 'incomplete' };
  let signed = false;
  try { signed = typeof d.s === 'string' && d.s.length > 0 && verify(linkOfferMessage({ k: d.w, b: st.node, n: st.nonce }), d.s, d.w) === true; } catch { signed = false; }
  if (!signed) return { ok: false, reason: 'not-signed' };
  return { ok: true, root: d.k, webid: d.w, botAddress: st.node, nonce: st.nonce, statement: st };
}

/**
 * Verify a linked device's statement at the bot: made for this bot and this op over exactly these arguments, by a device
 * whose delegation chains to `root` (any root when null — then the answer names it), not one that root has revoked
 * (`isRevoked(root, deviceId)`), fresh, its nonce unseen. Deny-by-default; says why.
 * @param {object} statement
 * @param {{node: string, op: string, args?: object, root?: string|null, isRevoked?: (root: string, deviceId: string) => boolean,
 *          nonces?: object, now?: () => number, windowMs?: number}} expect
 */
export function verifyLinkStatement(statement, { node, op, args = {}, root = null, isRevoked = null, nonces = null, now, windowMs } = {}) {
  const claimed = typeof statement?.delegation?.by === 'string' ? statement.delegation.by : null;
  return verifyDeviceStatement(statement, {
    domain: STATEMENT_DOMAINS.IDENTITY_LINK, node, op, args, root, nonces,
    ...(Number.isFinite(windowMs) ? { windowMs } : {}),
    // the tombstones are kept per root; the root the delegation names is checked by the chain right after
    isRevoked: typeof isRevoked === 'function' ? (deviceId) => Boolean(claimed) && isRevoked(claimed, deviceId) === true : null,
    ...(typeof now === 'function' ? { now } : {}),
  });
}

/** The contact rows that are bots this person's identity is linked to — the bot's address each, once. */
export function linkedBotsOf(contacts) {
  const out = new Set();
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c || typeof c.linkedRow !== 'string' || !c.linkedRow) continue;
    const addr = [c.peerAddr, c.webid].find((a) => typeof a === 'string' && a);
    if (addr) out.add(addr);
  }
  return [...out];
}

/** The link the bot sends for the app to open (`#koppel-bot=`): which bot, its relay, its name — no secret. */
export function encodeLinkStartLink(appUrl, { botAddress, relayUrl = null, botName = null }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), ...(botName ? { m: botName } : {}) }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#koppel-bot=${body}`;
}

/** Read the start link (the app's address bar, or the link pasted on the phone). */
export function parseLinkStartLink(link) {
  const m = /#koppel-bot=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null };
}
