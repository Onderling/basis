/**
 * ONE scanner, routed by what was scanned — the decision both shells read (Me → Scan; web: paste a code).
 *
 *   contact → add the person          (`onderling-contact://…`, or the link web shares: `…#contact=<card>`)
 *   invite  → join the circle          (`onderling-invite://…`, `?invite=`, or the app's own `?join=…&relay=…` link)
 *   pair    → pair a device/agent      (`onderling-pair://<addr>?name=…`)
 *   enroll  → add THIS device          (`onderling-enroll://…` / its link — a distinct scheme on purpose: the others
 *                                       make a CONNECTION, this one makes a DEVICE)
 *   claim   → claim a companion        (`ABCD-EFGH@<node>`, with or without "Claim:")
 *   screen  → connect a screen         (`onderling-connect://…`: the screen pairing opens with the offer in it)
 *   botlink → deliberately not routed  (`onderling-koppel:…`: the app makes it for the bot's chat; the scanner says so)
 *   bot     → add a bot (LAST)         (a peer address, `addr` or `addr|Name`, everywhere; a bare https URL only in the
 *                                       Contacts add field, `for: 'contacts-add'`; nothing is fetched before a confirm)
 *
 * Frits's three rules (2026-11-20): every code Basis makes is routed the same way (a classifier and a declared target in
 * the one table) or named as deliberately not (`SCAN_SCHEMES`, held by `lint-scan-schemes`); no scanner reads a code
 * outside this router; and a scanner called FOR one purpose routes only that kind and says so for anything else
 * (`routeScan(text, { for })`).
 *
 * The phone's scanner (`QrScannerModal`) and its link path call this router; there is no second classifier list.
 * Pure JS, no camera.
 */
import { classifyQrPayload } from '@onderling/qr';
import { parseInviteDeepLink } from './inviteDeepLink.js';
import { enrollOfferFromLink } from './enrollOffer.js';
import { contactCardFromLink } from './contactCardLink.js';
import { parseCompanionClaim } from './companionClaim.js';
import { QR_PAIR_SCHEME } from '../core/qrSchemes.js';
import { CONNECT_SCHEME } from './connectionPairing.js';
import { LINK_OFFER_SCHEME } from './identityLink.js';
import { ENROLL_SCHEME } from './enrollOffer.js';

const CONTACT_SCHEME = 'onderling-contact://';
const INVITE_SCHEME  = 'onderling-invite://';

/** @type {ReadonlyArray<{kind: string, classify: (text: string) => unknown|null}>} first match wins */
export const SCAN_CLASSIFIERS = Object.freeze([
  { kind: 'contact', classify: classifyContact },
  { kind: 'invite',  classify: classifyInvite },
  { kind: 'pair',    classify: (t) => (typeof t === 'string' && t.startsWith(QR_PAIR_SCHEME) ? t : null) },
  { kind: 'enroll',  classify: classifyEnroll },
  { kind: 'claim',   classify: (t) => (typeof t === 'string' ? parseCompanionClaim(t) : null) },
  { kind: 'screen',  classify: (t) => (typeof t === 'string' && t.startsWith(CONNECT_SCHEME) ? t : null) },
  { kind: 'botlink', classify: (t) => (typeof t === 'string' && t.startsWith(LINK_OFFER_SCHEME) ? t : null) },
  // LAST, after every scheme: a peer address is not a link, so it is a bot wherever it is scanned or pasted
  { kind: 'bot',     classify: (t) => (isPeerAddress(t) ? t : null) },
]);

/**
 * A peer address as a person pastes it: an Ed25519 key (43 base64url characters) or an NKN address (an optional
 * identifier, a dot, 64 hex characters), optionally followed by `|Name`. Nothing else: a word or a sentence is not one.
 */
export function isPeerAddress(text) {
  if (typeof text !== 'string') return false;
  const addr = text.split('|')[0].trim();
  return /^[A-Za-z0-9_-]{43}$/.test(addr) || /^(?:[A-Za-z0-9_-]+\.)?[0-9a-f]{64}$/.test(addr);
}

/**
 * WHAT A SCANNER OPENED FOR ONE PURPOSE TAKES. Its other kinds are refused in words. The Contacts add field takes a
 * person's card, an invite and a bot, and there alone a bare https URL counts as a bot (an agent card's address).
 */
export const SCAN_PURPOSES = Object.freeze({
  'contacts-add': Object.freeze(['contact', 'invite', 'bot']),
  screen:         Object.freeze(['screen']),
  pair:           Object.freeze(['pair']),
});
/** The purposes where a bare https URL is read as a bot's address (everywhere else it stays unknown, never opened). */
const URL_BOT_PURPOSES = new Set(['contacts-add']);

/**
 * EVERY SCHEME BASIS MAKES, and where its code goes: a routed kind, or `not: <why>`. `lint-scan-schemes` is red on a
 * scheme constant or an `onderling-…://` literal in the app that is not here, so a new code cannot go around the router.
 */
export const SCAN_SCHEMES = Object.freeze({
  [CONTACT_SCHEME]:    'contact',
  [INVITE_SCHEME]:     'invite',
  [QR_PAIR_SCHEME]:    'pair',
  [ENROLL_SCHEME]:     'enroll',
  [CONNECT_SCHEME]:    'screen',
  [LINK_OFFER_SCHEME]: 'botlink',
  'basis://':          'not: the app\'s own deep link (the sign-in callback); never a code to scan',
});

/**
 * WHERE each kind goes — a TABLE of DECLARED targets, never a shell callback: the router is a projector from a
 * scanned payload to a flow or op the manifests declare, plus the needs that carry the payload in.
 *   contact → pinboard's `add-contact` flow (the "what they see" sheet paints its persona/reveal needs, then the add)
 *   invite  → pinboard's `joinGroup` flow (the join wizard: the invite, the rules, the identity)
 *   enroll  → household's `enroll-device` flow (its first step stashes the offer; then the phrase)
 *   claim   → household's `claim-companion` flow (the line is its `claim` need)
 *   pair    → household's `pairCirclePeer` op (its `circle` param is picked from listMyCircles)
 * scanRoute.test.js holds every target to the manifests: an id named here that nothing declares is a red test.
 */
export const SCAN_TARGETS = Object.freeze({
  contact: { kind: 'flow', app: 'pinboard',     id: 'add-contact',     needs: (payload) => ({ payload }) },
  invite:  { kind: 'flow', app: 'pinboard',     id: 'joinGroup',       needs: (payload) => ({ invite: typeof payload === 'string' ? payload : payload?.inviteUri }) },
  enroll:  { kind: 'flow', app: 'household', id: 'enroll-device',   needs: (payload) => ({ offer: payload }) },
  claim:   { kind: 'flow', app: 'household', id: 'claim-companion', needs: (payload) => ({ claim: `${payload.code}@${payload.node}` }) },
  pair:    { kind: 'op',   app: 'household', id: 'pairCirclePeer',  needs: (payload) => ({ addr: payload }) },
  // the START of a screen's pairing has no op (offer → pick a code → ticks); its end is `grantSurface`: a view (Fable 2026-11-25)
  screen:  { kind: 'view', app: 'basis',     id: 'screenPairing',   needs: (payload) => ({ offer: payload }) },
  // the app made this for the bot's chat: the scanner says where it goes, it never opens anything here
  botlink: { kind: 'not',  app: 'basis',     id: 'botlink',         sayKey: 'circle.scan.botlink_for_chat', needs: () => ({}) },
  // no op adds a bot: the shared add (`addBotToGraph`) runs in the shell AFTER the person confirms (`botAddConfirm`),
  // so nothing is fetched from an address before they said yes (Fable 2026-11-25)
  bot:     { kind: 'view', app: 'basis',     id: 'addBot',          reason: 'the shared addBotToGraph, after a confirm that names the host or the address', needs: (payload) => ({ input: payload }) },
});

/**
 * The question before a bot is added (nothing is fetched before the yes): a URL by its host, an address by its name or
 * its first characters. One answer both shells say.
 * @returns {{key: string, params: object}}
 */
export function botAddConfirm(payload) {
  const s = String(payload ?? '').trim();
  if (/^https?:\/\//i.test(s)) {
    let host = s;
    try { host = new URL(s).host; } catch { /* the text as it is */ }
    return { key: 'circle.contacts.add_bot_confirm_host', params: { host } };
  }
  const [addr, ...rest] = s.split('|');
  const name = rest.join('|').trim();
  return { key: 'circle.contacts.add_bot_confirm_addr', params: { addr: name || `${addr.trim().slice(0, 8)}…` } };
}

/**
 * The words for what a scanned code's OP answered (an op target: pairing): done, refused because the circle is not mine,
 * or failed with its reason. One answer both shells say.
 * @returns {{key: string, params?: object}}
 */
export function scanOpResultWords(reply) {
  if (reply?.ok !== false) return { key: 'circle.pairedDevices.paired' };
  if (reply.outcome === 'not-my-circle') return { key: 'circle.scan.pair_not_mine' };
  if (reply.outcome === 'nothing-to-pick') return { key: 'circle.scan.pair_no_circle' };
  if (reply.outcome === 'unknown-op') return { key: 'scan_qr.scan_unknown' };
  return { key: 'circle.scan.pair_failed', params: { error: String(reply.error ?? reply.outcome ?? '') } };
}

/**
 * What a scanned (or pasted) text is, what it carries, and the declared target it goes to.
 * @param {unknown} text
 * @param {{for?: string|null}} [o]  `for`: the PURPOSE the scanner was called for (`SCAN_PURPOSES`): any other kind is
 *   refused (`refused: 'not-for-here'`, no target), so a scanner opened for one purpose cannot be steered into another flow
 * @returns {{kind: string, payload: unknown, target?: {kind: 'flow'|'op'|'view'|'not', app: string, id: string}, needs?: object, refused?: string, for?: string}}
 */
export function routeScan(text, { for: forKind = null } = {}) {
  const s = typeof text === 'string' ? text.trim() : '';
  // the one first-match loop (the phone's scanner calls this router)
  let hit = s ? classifyQrPayload(s, SCAN_CLASSIFIERS) : { kind: 'unknown' };
  // a bare https URL is a bot's address only where the purpose says so (the Contacts add field)
  if (hit.kind === 'unknown' && URL_BOT_PURPOSES.has(forKind) && /^https:\/\/\S+$/i.test(s)) hit = { kind: 'bot', payload: s };
  const t = SCAN_TARGETS[hit.kind];
  if (!t) return { kind: 'unknown', payload: s };
  const takes = forKind ? (SCAN_PURPOSES[forKind] ?? [forKind]) : null;
  if (takes && !takes.includes(hit.kind)) return { kind: hit.kind, payload: hit.payload, refused: 'not-for-here', for: forKind };
  return { kind: hit.kind, payload: hit.payload, target: { kind: t.kind, app: t.app, id: t.id }, needs: t.needs(hit.payload) };
}

/**
 * The words for a scan that opens nothing: an unreadable code, a code for somewhere else (`not`), or one a scanner called
 * for another purpose refuses. Null when the route opens something. One answer both shells say.
 */
export function scanSayKey(r) {
  if (!r || r.kind === 'unknown') return 'scan_qr.scan_unknown';
  if (r.refused) return 'circle.scan.not_for_here';
  if (r.target?.kind === 'not') return SCAN_TARGETS[r.kind]?.sayKey ?? 'scan_qr.scan_unknown';
  return null;
}

function classifyContact(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith(CONTACT_SCHEME)) return text;
  const fromLink = contactCardFromLink(text);
  // a SHARED link carries its one-time token beside the card (L806): keep the whole link then, so the shared add
  // (`addContactAs`) keeps the token with the contact; the first turn to them carries it
  if (fromLink.ok && fromLink.token) return text;
  return fromLink.ok ? fromLink.payload : null;
}

function classifyInvite(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith(INVITE_SCHEME)) return text;
  // Every link form goes through the SHARED reader: it returns the invite URI plus the relay the link names.
  return parseInviteDeepLink(text);
}

function classifyEnroll(text) {
  if (typeof text !== 'string') return null;
  const parsed = enrollOfferFromLink(text);
  return parsed.ok ? parsed.uri : null;
}
