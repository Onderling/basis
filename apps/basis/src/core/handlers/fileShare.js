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
 * Three seams, all injected (this module owns no store and no UI):
 *   identityOf(fromAddr) → the PERSON at that address, so a file from someone you already have a
 *     thread with lands IN it rather than opening a second one keyed by the route it arrived on
 *     (Frits 2026-09-03: threads are keyed by identity). Unresolvable falls back to the address.
 *   deliverToThread({ contactId, fromAddr, file, messageId, ts })
 *     — persist the turn into the sender's durable DM thread AND surface it live if that thread is
 *       open. The shells wire it to `contactThreadChannel.persistInbound` + their own live append.
 *   publishEvent(event)
 *     — the notification line on the event log ("📎 file shared: …"), unchanged: the log is how a
 *       closed thread's arrival still leaves a visible trace.
 */
import { contactIdFor } from './threadedChat.js';

/**
 * THE PERSON SEAL on a file (2026-09-17): a file to a contact whose person key is on record travels as a box
 * sealed to that key — the same `sealFor` the text turn uses — beside a stub `{ id, name, mime, size }`; the
 * bytes are inside the box. A box the receiver cannot open is dropped and said, never handed up as a file.
 * Without a key on record the bytes ride inline, sealed to the device only, exactly as before (the stated
 * fallback through the alpha).
 *
 * The SEND half — the envelope `sendFile` puts on the wire. Pure apart from `sealFor`, so the builtin and a
 * walk build the same thing.
 * @param {{ file: { id, name, mime, size, dataB64 }, peerAddr: string, sealFor?: Function, sentAt?: number }} a
 */
export async function buildFileShareEnvelope({ file, peerAddr, sealFor, sentAt = Date.now() } = {}) {
  const stub = { id: file.id, name: file.name, mime: file.mime || 'application/octet-stream', size: file.size };
  let sealed = null;
  if (typeof sealFor === 'function') {
    try { sealed = await sealFor(peerAddr, { file: { ...stub, dataB64: file.dataB64 } }); } catch { sealed = null; }
  }
  return sealed
    ? { type: 'p2p-chat', subtype: 'file-share', file: stub, sealed, sentAt }
    : { type: 'p2p-chat', subtype: 'file-share', file: { ...stub, dataB64: file.dataB64 }, sentAt };
}

export function makeHandleFileShare({
  deliverToThread, publishEvent, notePeer, identityOf, openFor = null, logger = console,
} = {}) {
  if (typeof deliverToThread !== 'function') throw new Error('makeHandleFileShare: deliverToThread required');

  return async function handleFileShare(fromAddr, payload) {
    let f = payload?.file;
    let sealedTo = null;
    if (payload?.sealed && typeof payload.sealed === 'object') {
      // Sealed to the person: the bytes are in the box. Open with my key for the version it names, or drop.
      const content = typeof openFor === 'function' ? await Promise.resolve(openFor(payload.sealed, fromAddr)).catch(() => null) : null;
      if (!content?.file?.dataB64) {
        logger.warn?.(`[peer] a file sealed to person-key version ${payload.sealed?.to?.version ?? '?'} did not open here — dropped, not shown`);
        return;
      }
      f = { ...(f ?? {}), ...content.file };
      sealedTo = { to: payload.sealed.to ?? null, from: payload.sealed.from ?? null };
    }
    if (!f?.id || !f?.name || !f?.dataB64) {
      logger.warn?.('[peer] file-share missing fields', payload);
      return;
    }
    // Receiving a direct file makes the sender a KNOWN PEER (the classic first-DM rule): without this
    // the turn persisted into a thread no list could reach — the peer graph learns peers at SEND time,
    // so a receiver who never dialled this sender had no contact row to open the thread from.
    const contactId = contactIdFor(identityOf, fromAddr);
    try { notePeer?.(contactId); } catch { /* a row is a convenience; the thread persists regardless */ }
    try {
      deliverToThread({
        contactId,
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
        // What the box was sealed to (versions + keys, never the box) — the thread's "sealed to" mark reads it.
        ...(sealedTo ? { sealed: sealedTo } : {}),
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
