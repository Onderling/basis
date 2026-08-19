/**
 * contactReplyInbox — a tiny module-level emitter for inbound contact-bot replies
 * (feedback-extension, mobile).
 *
 * On mobile, ChatScreen owns the peer router (it stays mounted) while the
 * Contacten thread lives in CircleLauncherScreen — two separate screens. This
 * singleton bridges them the same way the circle chat / rules / recipe wires do
 * (ChatScreen's router writes; the launcher screen reads): ChatScreen registers
 * `bundle.contactChannel.replyHandler(r => contactReplyInbox.push(r))` under the
 * channel's reply subtype, and the open ContactThreadScreen subscribes for its
 * contactId. Pure JS, no RN — unit-testable.
 */

const subscribers = new Set();

/** Push an inbound reply `{ fromAddr, threadId, text, buttons?, replyTo?, messageId? }`. */
export function pushContactReply(reply) {
  for (const fn of subscribers) {
    try { fn(reply); } catch { /* a bad subscriber must not break delivery to others */ }
  }
}

/** Subscribe to inbound replies; returns an unsubscribe fn. */
export function subscribeContactReplies(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Test/reset helper. */
export function _clearContactReplySubscribers() {
  subscribers.clear();
}
