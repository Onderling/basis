/**
 * ONE scanner, routed by what was scanned — the decision both shells read (Me → Scan; web: paste a code).
 *
 *   contact → add the person          (`onderling-contact://…`, or the link web shares: `…#contact=<card>`)
 *   invite  → join the circle          (`onderling-invite://…`, `?invite=`, or the app's own `?join=…&relay=…` link)
 *   pair    → pair a device/agent      (`onderling-pair://<addr>?name=…`)
 *   enroll  → add THIS device          (`onderling-enroll://…` / its link — a distinct scheme on purpose: the others
 *                                       make a CONNECTION, this one makes a DEVICE)
 *   claim   → claim a companion        (`ABCD-EFGH@<node>`, with or without "Claim:")
 *
 * The classifier list moved here from mobile's `core/qrClassifiers.js` (which now re-exports it), unchanged in what it
 * reads and in its order, so the native scanner and the router cannot disagree. Pure JS, no camera.
 */
import { parseInviteDeepLink } from './inviteDeepLink.js';
import { enrollOfferFromLink } from './enrollOffer.js';
import { contactCardFromLink } from './contactCardLink.js';
import { parseCompanionClaim } from './companionClaim.js';
import { QR_PAIR_SCHEME } from '../core/qrSchemes.js';

const CONTACT_SCHEME = 'onderling-contact://';
const INVITE_SCHEME  = 'onderling-invite://';

/** @type {ReadonlyArray<{kind: string, classify: (text: string) => unknown|null}>} first match wins */
export const SCAN_CLASSIFIERS = Object.freeze([
  { kind: 'contact', classify: classifyContact },
  { kind: 'invite',  classify: classifyInvite },
  { kind: 'pair',    classify: (t) => (typeof t === 'string' && t.startsWith(QR_PAIR_SCHEME) ? t : null) },
  { kind: 'enroll',  classify: classifyEnroll },
  { kind: 'claim',   classify: (t) => (typeof t === 'string' ? parseCompanionClaim(t) : null) },
]);

/**
 * WHERE each kind goes — a TABLE of DECLARED targets, never a shell callback: the router is a projector from a
 * scanned payload to a flow or op the manifests declare, plus the needs that carry the payload in.
 *   contact → stoop's `add-contact` flow (the "what they see" sheet paints its persona/reveal needs, then the add)
 *   invite  → stoop's `joinGroup` flow (the join wizard: the invite, the rules, the identity)
 *   enroll  → household's `enroll-device` flow (its first step stashes the offer; then the phrase)
 *   claim   → household's `claim-companion` flow (the line is its `claim` need)
 *   pair    → household's `pairCirclePeer` op (its `circle` param is picked from listMyCircles)
 * scanRoute.test.js holds every target to the manifests: an id named here that nothing declares is a red test.
 */
export const SCAN_TARGETS = Object.freeze({
  contact: { kind: 'flow', app: 'stoop',     id: 'add-contact',     needs: (payload) => ({ payload }) },
  invite:  { kind: 'flow', app: 'stoop',     id: 'joinGroup',       needs: (payload) => ({ invite: typeof payload === 'string' ? payload : payload?.inviteUri }) },
  enroll:  { kind: 'flow', app: 'household', id: 'enroll-device',   needs: (payload) => ({ offer: payload }) },
  claim:   { kind: 'flow', app: 'household', id: 'claim-companion', needs: (payload) => ({ claim: `${payload.code}@${payload.node}` }) },
  pair:    { kind: 'op',   app: 'household', id: 'pairCirclePeer',  needs: (payload) => ({ addr: payload }) },
});

/**
 * What a scanned (or pasted) text is, what it carries, and the declared target it goes to.
 * @param {unknown} text
 * @returns {{kind: string, payload: unknown, target?: {kind: 'flow'|'op', app: string, id: string}, needs?: object}}
 */
export function routeScan(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (s) {
    for (const c of SCAN_CLASSIFIERS) {
      let payload = null;
      try { payload = c.classify(s); } catch { payload = null; }
      if (payload != null) {
        const t = SCAN_TARGETS[c.kind];
        return { kind: c.kind, payload, target: { kind: t.kind, app: t.app, id: t.id }, needs: t.needs(payload) };
      }
    }
  }
  return { kind: 'unknown', payload: s };
}

function classifyContact(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith(CONTACT_SCHEME)) return text;
  const fromLink = contactCardFromLink(text);
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
