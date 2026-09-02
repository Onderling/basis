/**
 * Inbound file-share handler — a peer sent this device a file over the sealed wire.
 *
 * It lands in the SENDER'S CONTACT THREAD (decided with Frits 2026-09-02): a DM-shaped thing belongs
 * in the DM surface, and every sender has one by construction — completing the HI puts them in the
 * peer graph, which is a contact row, which is a thread. It used to land in `addMainBubble` →
 * ChatScreen's main thread, which mobile v2 mounts but permanently hides ("No '← chat' route reveals
 * it") — the card painted faithfully into a room no user could enter, found the day a real photo
 * finally crossed the wire.
 *
 * Two seams, both injected (this module owns no store and no UI):
 *   deliverToThread({ fromAddr, file, messageId, ts })
 *     — persist the turn into the sender's durable DM thread AND surface it live if that thread is
 *       open. The shells wire it to `contactThreadChannel.persistInbound` + their own live append.
 *   publishEvent(event)
 *     — the notification line on the event log ("📎 file shared: …"), unchanged: the log is how a
 *       closed thread's arrival still leaves a visible trace.
 */
export function makeHandleFileShare({
  deliverToThread, publishEvent, notePeer, logger = console,
} = {}) {
  if (typeof deliverToThread !== 'function') throw new Error('makeHandleFileShare: deliverToThread required');

  return function handleFileShare(fromAddr, payload) {
    const f = payload?.file;
    if (!f?.id || !f?.name || !f?.dataB64) {
      logger.warn?.('[peer] file-share missing fields', payload);
      return;
    }
    // Receiving a direct file makes the sender a KNOWN PEER (the classic first-DM rule): without this
    // the turn persisted into a thread no list could reach — the peer graph learns peers at SEND time,
    // so a receiver who never dialled this sender had no contact row to open the thread from.
    try { notePeer?.(fromAddr); } catch { /* a row is a convenience; the thread persists regardless */ }
    try {
      deliverToThread({
        fromAddr,
        file: {
          id:      f.id,
          name:    f.name,
          mime:    f.mime ?? 'application/octet-stream',
          size:    f.size,
          dataB64: f.dataB64,
        },
        // The sender's file id doubles as the dedup nonce, so a relay-replayed share never lands twice.
        messageId: `file-share-${f.id}`,
        ts: typeof payload?.sentAt === 'number' ? payload.sentAt : Date.now(),
      });
    } catch (err) {
      logger.warn?.('[peer] file-share delivery failed', err?.message ?? err);
    }
    publishEvent?.({
      app:     'folio',
      type:    'notification',
      actor:   fromAddr,
      payload: { message: `📎 file shared: ${f.name} (${_formatBytes(f.size)})` },
    });
  };
}

function _formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  if (n < 1024)         return `${n} B`;
  if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
