/**
 * ACCEPT A MESSAGE REQUEST (Frits 2026-11-12): the person chooses someone who wrote to them first. One act, the same on
 * every shell: the held card goes into the book exactly as a scanned card does (pinboard's `acceptMessageRequest`, which
 * also removes the request), and the held turns go onto the contact thread as they landed, in order (the contact
 * channel's `persistInbound`, which also carries them to the person's other devices). From then on the sender is a kept
 * contact: their turns land in the thread, the receipt follows the person's setting, the pair circle forms on the next
 * turn either side sends.
 *
 * @param {object} a
 * @param {(app: string, op: string, args?: object) => Promise<any>} a.callSkill
 * @param {{ persistInbound: Function }} a.channel  the shell's contact channel
 * @param {string} a.from          the sender's identity, as the request names it
 * @param {string|null} [a.persona] the self the request is for
 * @param {'handle'|'profile'|'full'} [a.revealPreset] what the new contact sees of you
 * @returns {Promise<{ accepted: true, contact: object, turns: number } | { accepted: false, reason: string }>}
 */
import { heldNoteOf, heldNoteKey } from './heldNote.js';

export { heldNoteOf, heldNoteKey };

export async function acceptMessageRequest({ callSkill, channel, from, persona = null, revealPreset = null } = {}) {
  if (typeof callSkill !== 'function' || typeof channel?.persistInbound !== 'function') return { accepted: false, reason: 'not-composed' };
  if (typeof from !== 'string' || !from) return { accepted: false, reason: 'no-sender' };
  const r = await callSkill('pinboard', 'acceptMessageRequest', { from, ...(persona ? { persona } : {}), ...(revealPreset ? { revealPreset } : {}) });
  if (!r || r.error) return { accepted: false, reason: r?.error ?? 'no-answer' };
  const turns = Array.isArray(r.turns) ? [...r.turns].sort((x, y) => (x.ts - y.ts) || String(x.messageId).localeCompare(String(y.messageId))) : [];
  for (const t of turns) {
    // a turn held after a refusal keeps its note on the thread (what was not kept: the text cut, a file left off)
    const held = heldNoteOf(t.refused);
    try { await channel.persistInbound({ contactId: from, fromAddr: from, text: t.text ?? '', messageId: t.messageId, ts: t.ts, ...(held ? { held } : {}) }); } catch { /* the next turn still lands; a lost held turn is the cost */ }
  }
  return { accepted: true, contact: r.contact ?? null, turns: turns.length };
}

/**
 * The Contacten requests section's rows, from `listMessageRequests`: the name the sender's card SAYS (unverified, null
 * when it names none), the first line they wrote, how many turns are held, and whether the person ignored it. In the
 * order given (newest last turn first, as the list returns them).
 * @param {Array<object>} requests
 * `label`: the locale key the row's name line is painted with, decided here once for every shell: a member's request
 * (`member`: their circle name, from this device's own roster) is named as from your circle; a card's name is marked
 * as the sender's claim; no name is 'someone without a name'. Paint `t(label, { name })`.
 * `notes`: the locale keys of what the held turns could not keep (`heldNote.js`), one plain line each under the row.
 * @returns {Array<{from: string, name: string|null, label: string, member: boolean, notes: string[], firstLine: string, count: number, ignored: boolean}>}
 */
export function messageRequestRows(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter((q) => q && typeof q.from === 'string' && q.from).map((q) => {
    const turns = Array.isArray(q.turns) ? q.turns : [];
    const first = turns.find((x) => typeof x?.text === 'string' && x.text.trim()) ?? null;
    const name = typeof q.name === 'string' && q.name.trim() ? q.name.trim() : null;
    const member = q.member === true && !!name;
    // the notes of turns held after a refusal (what was not kept), once each, in the order they first appear
    const notes = [...new Set(turns.map((x) => heldNoteKey(heldNoteOf(x?.refused))).filter(Boolean))];
    return {
      from: q.from,
      name,
      member,
      label: member ? 'circle.contacts.requests.member' : (name ? 'circle.contacts.requests.says' : 'circle.contacts.requests.no_name'),
      notes,
      firstLine: first ? first.text.split('\n')[0].trim() : '',
      count: turns.length,
      ignored: q.state === 'ignored',
    };
  });
}

/** Ignore a request: it stays, marked, still acceptable; the sender sees nothing different. */
export async function ignoreMessageRequest({ callSkill, from, persona = null } = {}) {
  if (typeof callSkill !== 'function' || typeof from !== 'string' || !from) return { ignored: false, reason: 'not-composed' };
  const r = await callSkill('pinboard', 'ignoreMessageRequest', { from, ...(persona ? { persona } : {}) });
  return r?.request ? { ignored: true } : { ignored: false, reason: r?.error ?? 'no-answer' };
}

/**
 * Block the sender of a request, on this device: onto the block list (direct contact only: their direct messages are
 * refused from now on; a circle is untouched), with the name their card said, and the request goes (on every device of
 * the person: an own-devices write).
 */
export async function blockFromRequest({ callSkill, from, name = null, persona = null } = {}) {
  if (typeof callSkill !== 'function' || typeof from !== 'string' || !from) return { blocked: false, reason: 'not-composed' };
  const b = await callSkill('basis', 'mute', { peer: from, ...(name ? { label: name } : {}) });
  if (b && b.ok === false) return { blocked: false, reason: b.error ?? 'refused' };
  await callSkill('pinboard', 'removeMessageRequest', { from, ...(persona ? { persona } : {}) });
  return { blocked: true };
}
