/**
 * WHAT A "+" IN A CONTACT THREAD LEAVES BEHIND, for both shells.
 *
 * The thread's "+" runs `send-file` addressed to this contact. The op answers in the words of the old slash
 * door ("sent plant.png (390 bytes) → <the peer's key>"), which in a thread is noise at best and a key on
 * screen at worst. In a thread the answer is the bubble: the sent file is recorded on our side of the thread
 * (the same record a typed turn gets) and nothing else is said. Only what the bubble cannot say gets a line:
 * the file is waiting for them, or it did not reach them. A cancelled pick says nothing.
 *
 * @param {object|null} r                 what the op answered
 * @param {object} deps
 * @param {{persistOutbound?: Function}|null} deps.channel   the shared contact-thread channel
 * @param {string} deps.contactId
 * @param {string} deps.peerAddr
 * @param {(key: string, params?: object) => string} deps.t
 * @returns {Promise<{ file: object|null, messageId: string|null, say: string|null }>}
 */
export async function settleContactAttach(r, { channel = null, contactId, peerAddr, t } = {}) {
  const file = r?.file && typeof r.file === 'object' && r.file.id ? r.file : null;
  if (file) {
    const messageId = `file-share-${file.id}`;
    try { await channel?.persistOutbound?.({ contactId, peerAddr, file, messageId }); } catch { /* the bubble below still shows it */ }
    return { file, messageId, say: r.held === true ? t('circle.attach.file_held', { name: file.name ?? '' }) : null };
  }
  if (r?.code === 'cancelled') return { file: null, messageId: null, say: null };
  if (r?.code === 'not_reached') return { file: null, messageId: null, say: t('circle.attach.file_not_reached') };
  return { file: null, messageId: null, say: r?.error ?? null };
}
