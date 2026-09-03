/**
 * What is a NOTICEBOARD POST — the one gate, in the type taxonomy where it belongs.
 *
 * The circle item store holds more than asks/offers: the membership lifecycle + rules documents
 * (internal bookkeeping) and the circle CHAT lines (stored purely so a conversation survives a
 * reload) live beside the real posts, and `listOpen` with no intent returns them all. Every surface
 * that shows "posts" — the noticeboard tab, the recipe blocks, stoop's own brief — must filter
 * through THIS gate, or chat lines surface as withdrawable "requests" (found live on the
 * noticeboard 2026-07-x, and again in `/brief` on 2026-07-31).
 *
 * It lived in basis (`circleStoopScope.js`) while stoop needed it too and could not import an app —
 * so `/brief` kept the leak for a month with a note saying why (fixing it in place would have meant
 * a second literal type-string in a second app, which the duplication invariant forbids). One home
 * here now; both apps import it.
 */

/**
 * Stoop item types that are NOT user-facing noticeboard posts — the membership lifecycle + rules
 * documents, and the circle chat lines.
 *
 * `circle-chat-message` earns its place here for the same reason the others do, but the symptom was
 * louder: every line typed in a circle's Conversation also appeared on the Noticeboard — with a
 * "Withdraw" action when it was yours — and, because a chat item carries its circle as
 * `source.circleId` (a hint the circle-scope reader does not read), on EVERY circle's Noticeboard.
 */
/** The canonical types a noticeboard post can be — what the board shows and what the circle carries as a post. */
export const NOTICEBOARD_POST_TYPES = Object.freeze(['request', 'offer', 'announcement']);

export const SYSTEM_STOOP_TYPES = new Set([
  'group-rules', 'membership-code', 'membership-redemption', 'circle-chat-message',
]);

/** True when `item` is a real noticeboard post (an ask/offer), not a system item. */
export function isNoticeboardPost(item) {
  if (SYSTEM_STOOP_TYPES.has(item?.type)) return false;
  // The local-first substrate/pseudo-pod collapses every stoop item to `type:'post'`,
  // losing the semantic type — but the original `source` shape survives. Recognise the
  // membership lifecycle + rules documents by their distinctive source fields so they
  // don't surface as noticeboard posts even when the type is flattened.
  //
  // This is not a belt-and-braces branch: basis's own `adaptStoopReply` (realAgent.js)
  // rewrites `type: 'post'` onto EVERY `listOpen` row, so on the live path the type
  // check above never fires and the recognisers below are the whole filter.
  const src = item?.source;
  if (src && typeof src === 'object') {
    if (src.rules != null) return false;                          // group-rules
    if (typeof src.code === 'string' && src.code) return false;   // membership-code
    if (src.redeemedBy != null) return false;                     // membership-redemption
    // circle-chat-message — the only stoop item keyed by a message id (stoop's
    // `broadcastCircleMessage` local mirror + `ingestCircleMessage` receive mirror are
    // the only writers of `source.msgId`; the other circle broadcasts put theirs on the
    // wire `extras`, never on a stored item).
    if (typeof src.msgId === 'string' && src.msgId) return false;
    // a 1:1 chat turn (a reply to a post travels as one) — chat-p2p keys it by its wire nonce and the
    // thread it answers; it is a conversation, never a post, and it showed on the replier's own board
    // as a question with a "withdraw" chip until browser story 4 caught it (2026-09-03).
    if (typeof src.nonce === 'string' && src.nonce && typeof src.threadId === 'string' && src.threadId) return false;
  }
  return true;
}

/** Is this row a noticeboard POST (a canonical post type, not a system row)? Stricter than `isNoticeboardPost`, which only excludes system rows. */
export function isNoticeboardPostType(item) {
  return NOTICEBOARD_POST_TYPES.includes(item?.type) && isNoticeboardPost(item);
}
