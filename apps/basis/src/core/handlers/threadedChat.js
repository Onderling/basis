/**
 * Inbound threaded-chat handler — a peer answered one of OUR NOTICEBOARD POSTS (stoop's
 * `respondToItem` sends a `chat-message` whose `threadId` is the post id).
 *
 * The reply lands in the REPLIER'S CONTACT THREAD (decided with Frits 2026-09-03): the answer to a
 * post is the start of a 1:1 conversation with the person who answered, and every peer has a contact
 * thread by construction. Before this, the v2 shells had no home for it at all — web dropped the
 * subtype (no router entry), mobile painted it into the hidden main thread — so a person could answer
 * a post and the poster never saw a word of it.
 *
 * The wire dedup nonce doubles as the message id, so a relay-replayed reply never lands twice, and
 * `replyTo` carries the post id so the thread can say WHICH post this answers.
 *
 * Two seams, both injected (this module owns no store and no UI):
 *   deliverToThread({ fromAddr, text, messageId, ts, replyTo })
 *     — persist the turn into the sender's durable DM thread AND surface it live if that thread is
 *       open. The shells wire it to `contactThreadChannel.persistInbound` + their own live append.
 *   notePeer(fromAddr)
 *     — make the replier a contact row (the graph otherwise only learns peers at send time).
 */
export function makeHandleThreadedChat({ deliverToThread, notePeer, logger = console } = {}) {
  if (typeof deliverToThread !== 'function') throw new Error('makeHandleThreadedChat: deliverToThread required');

  return function handleThreadedChat(fromAddr, payload) {
    const body = payload?.body;
    if (typeof body !== 'string' || body === '') {
      // Infrastructure envelopes (handshakes, claims) routinely arrive without a body — not ours.
      logger.debug?.('[peer] chat-message without body from', String(fromAddr).slice(0, 16) + '…');
      return;
    }
    try { notePeer?.(fromAddr); } catch { /* a row is a convenience; the thread persists regardless */ }
    const nonce = typeof payload.nonce === 'string' && payload.nonce ? payload.nonce : null;
    try {
      deliverToThread({
        fromAddr,
        text:      body,
        messageId: nonce ? `chat-${nonce}` : undefined,
        ts:        typeof payload.sentAt === 'number' ? payload.sentAt : Date.now(),
        ...(typeof payload.threadId === 'string' && payload.threadId ? { replyTo: payload.threadId } : {}),
        ...(typeof payload.senderDisplay === 'string' && payload.senderDisplay ? { senderDisplay: payload.senderDisplay } : {}),
      });
    } catch (err) {
      logger.warn?.('[peer] threaded chat delivery failed', err?.message ?? err);
    }
  };
}
