/**
 * Reply to a noticeboard post — the ONE path both shells take (web≡mobile by construction).
 *
 * The op (`stoop.respondToItem`) sends the reply to the poster over the sealed wire and names who it
 * went to. This helper then persists OUR side of that exchange into the poster's contact thread, so the
 * conversation the reply starts is visible and durable on the replier's device too — and returns the
 * poster's address so the shell can open that thread right away.
 *
 * @param {object} a
 * @param {Function} a.callSkill         the waist (`callSkill(app, op, args)`)
 * @param {object|null} [a.contactChannel] the shell's contact-thread channel (durability is best-effort)
 * @param {string} a.itemId              the post
 * @param {string} a.body                the reply text
 * @returns {Promise<{ ok: boolean, toPubKey?: string|null, error?: string }>}
 */
export async function replyToPost({ callSkill, contactChannel = null, itemId, body } = {}) {
  if (typeof callSkill !== 'function') throw new Error('replyToPost: callSkill required');
  let r;
  try { r = await callSkill('stoop', 'respondToItem', { itemId, body }); }
  catch (err) { return { ok: false, error: err?.message ?? String(err) }; }
  if (!r || r.error || r.ok === false) return { ok: false, error: r?.error ?? 'reply-failed' };
  const toPubKey = typeof r.toPubKey === 'string' && r.toPubKey ? r.toPubKey : null;
  if (toPubKey && typeof contactChannel?.persistOutbound === 'function') {
    try {
      await contactChannel.persistOutbound({
        contactId: toPubKey, peerAddr: toPubKey, text: body, replyTo: itemId,
        messageId: r.itemId ? `post-reply-${r.itemId}` : undefined,
      });
    } catch { /* the reply is on the wire; a missing local copy is the lesser loss */ }
  }
  return { ok: true, toPubKey };
}
