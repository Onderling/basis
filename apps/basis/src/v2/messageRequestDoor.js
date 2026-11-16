/**
 * THE DOOR OF THE CONTACT CHANNEL (Frits 2026-11-12): a first message from someone the person did not choose is a
 * REQUEST, decided before anything is kept. Before this door a stranger's first turn wrote a full contact row (the card
 * riding the message went into the book) and the pair roster made a pair circle, so "in the book" meant "wrote first",
 * and the delivery receipt and the person key's allowlist could not tell a chosen contact from a stranger.
 *
 * The decision, per turn:
 *   - KNOWN → 'known': the turn goes on as always (thread, card, pair roster, receipt by the person's setting). Known is
 *     what this device already holds: a peer it knows (its own devices, a member of a circle it is in, a contact in the
 *     book, hidden ones included: a hidden contact who writes again comes back), or someone the person wrote to first
 *     (an outbound turn of theirs in the thread: they were chosen).
 *   - NOT KNOWN, within the stranger budgets (the function profile door's own: bytes per turn, turns per key per day,
 *     stranger turns per hour) → the turn is HELD on the sender's message request → 'held'. No book row, no pair circle,
 *     no thread turn, no receipt: the person accepts, ignores or blocks.
 *   - NOT KNOWN, within the budgets, to a persona whose policy is 'open' (anyone may write; a bot's by default) →
 *     'known': the turn goes on as a known one does.
 *   - NOT KNOWN, but a member of one of the persona's circles and the persona lets them write (`isMember`) → 'member':
 *     a thread, but no contact row until the person answers (answering is choosing).
 *   - NOT KNOWN, but the FIRST OPENER of a link the persona shared (L806): the turn carries the link's token and uses it
 *     (`useLink`), or a later turn of theirs while the link's use names them (`letOnByLink`) → 'member', as above.
 *     Anyone after the first opener (the link is used), or a withdrawn or expired link → decided as any stranger's.
 *   - NOT KNOWN, a member of one of the persona's circles, but the persona does NOT let them write first (the person
 *     switched it off after they wrote, never having answered them: `coMember`) → HELD as a request WITHOUT a card (their
 *     card rode only their first message), shown by the name they have in the circle (Fable's ruling, 2026-11-14).
 *   - past the budgets → 'dropped', with a count line (kind + reason, never who).
 *   - a turn the hold REFUSES (no card on a new request, a card naming someone else, a file, too large, or the hold
 *     failing) is NEVER dropped silently: the refusal is written to the refusal log with its reason code (`refusal`), and
 *     the turn is held anyway on a second call marked `refused` (the hold leaves off what it cannot keep). Only when
 *     that cannot hold it either (no self to hold it for) → 'dropped', both refusals logged.
 * A blocked sender never reaches this door: the secure agent's block set drops them below every channel.
 *
 * Pure: what is known, what the person wrote, and the hold are injected (the agent's `messageRequests`, the channel's
 * own thread store).
 */

import { createInboundAdmission } from './inboundAdmission.js';

/**
 * @param {object} a
 * @param {(key: string) => Promise<boolean>|boolean} a.isKnown       a peer this device knows
 * @param {(contactId: string) => Promise<boolean>|boolean} [a.iWrote] the person wrote to them first
 * @param {(turn: object) => Promise<{held: boolean, reason?: string}>} a.hold  hold a turn on the sender's request
 * @param {(e: {kind: string, reason: string}) => void} [a.count]
 * @param {() => number} [a.now]
 * @returns {(m: {contactId: string, fromAddr: string, text?: string, card?: string|null, messageId?: string, ts?: number, file?: boolean, policy?: 'request'|'open'}) =>
 *   Promise<'known'|'member'|'held'|'dropped'>}
 */
export function createMessageRequestDoor({ isKnown, iWrote = null, isMember = null, coMember = null, useLink = null, letOnByLink = null, hold, refusal = null, count = null, now = Date.now } = {}) {
  if (typeof isKnown !== 'function') throw new TypeError('createMessageRequestDoor: isKnown is required');
  if (typeof hold !== 'function') throw new TypeError('createMessageRequestDoor: hold is required');
  const said = (reason) => { try { count?.({ kind: 'message-request-dropped', reason }); } catch { /* a count never breaks a turn */ } };
  // the stranger budgets, as the function profile's door keeps them; an OPEN door: a stranger within budget gets in (as
  // a request, below), and a known peer is admitted without a question
  const admission = createInboundAdmission({ admit: async () => ({ known: true }), isKnown, answered: iWrote, open: true, count, now });

  return async function decide({ contactId, fromAddr, text = '', card = null, messageId = null, ts = null, file = false, policy = 'request', to = null, linkToken = null } = {}) {
    const r = await admission({ contactId, fromAddr, text, messageId, channel: 'contact' });
    if (!r.admitted) return 'dropped';   // the admission said its own count line
    if (!r.stranger || policy === 'open') return 'known';
    // a shared link's first opener: their first turn uses the link, their later turns pass while its use names them
    const by = contactId || fromAddr;
    if (linkToken && typeof useLink === 'function') {
      try { if ((await useLink({ token: linkToken, by, to, ...(card ? { card } : {}) }))?.ok === true) return 'member'; } catch { /* decided as a stranger's */ }
    }
    if (typeof letOnByLink === 'function') {
      try { if ((await letOnByLink({ by, to })) === true) return 'member'; } catch { /* decided as a stranger's */ }
    }
    let member = false;
    try { member = typeof isMember === 'function' && (await isMember({ contactId, fromAddr, to })) === true; } catch { member = false; }
    if (member) return 'member';
    // a co-member the persona does not let write first: held without a card, named as in the circle
    let memberName = null;
    try { if (typeof coMember === 'function') { const n = (await coMember({ contactId, fromAddr, to }))?.name; memberName = typeof n === 'string' && n.trim() ? n.trim() : null; } } catch { memberName = null; }
    const turn = { from: contactId || fromAddr, messageId: messageId || `${fromAddr}:${now()}`, ts: Number.isFinite(ts) ? ts : now(), text: String(text ?? ''), ...(card ? { card } : {}), ...(file ? { file: true } : {}), ...(to ? { to } : {}), ...(memberName ? { memberName } : {}) };
    const tryHold = async (t) => {
      let r;
      try { r = await hold(t); } catch { return { held: false, reason: 'hold-threw' }; }
      if (r?.held === true) return r;
      if (typeof r?.reason === 'string' && r.reason) return r;
      return { held: false, reason: r == null ? 'no-answer' : (r.error ? 'invalid' : 'not-held') };   // a dispatch error carries no code
    };
    const refused = (reason) => { try { refusal?.(reason); } catch { /* the log never breaks a turn */ } };
    const first = await tryHold(turn);
    if (first.held) return 'held';
    const why = typeof first.reason === 'string' && first.reason ? first.reason : 'not-held';
    refused(why);
    // NOTHING DROPPED SILENTLY: held anyway, marked with the refusal
    const again = await tryHold({ ...turn, refused: why });
    if (again.held) return 'held';
    refused(typeof again.reason === 'string' && again.reason ? again.reason : 'not-held');
    said(why);
    return 'dropped';
  };
}
