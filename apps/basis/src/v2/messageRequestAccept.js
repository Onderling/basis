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
export async function acceptMessageRequest({ callSkill, channel, from, persona = null, revealPreset = null } = {}) {
  if (typeof callSkill !== 'function' || typeof channel?.persistInbound !== 'function') return { accepted: false, reason: 'not-composed' };
  if (typeof from !== 'string' || !from) return { accepted: false, reason: 'no-sender' };
  const r = await callSkill('pinboard', 'acceptMessageRequest', { from, ...(persona ? { persona } : {}), ...(revealPreset ? { revealPreset } : {}) });
  if (!r || r.error) return { accepted: false, reason: r?.error ?? 'no-answer' };
  const turns = Array.isArray(r.turns) ? [...r.turns].sort((x, y) => (x.ts - y.ts) || String(x.messageId).localeCompare(String(y.messageId))) : [];
  for (const t of turns) {
    try { await channel.persistInbound({ contactId: from, fromAddr: from, text: t.text ?? '', messageId: t.messageId, ts: t.ts }); } catch { /* the next turn still lands; a lost held turn is the cost */ }
  }
  return { accepted: true, contact: r.contact ?? null, turns: turns.length };
}
