/**
 * inboxDoor — the bot's contact inbox as a door to its assistant, on a node that runs a FUNCTION profile.
 *
 * A node's contact thread is an inbox, and an inbox belongs to whoever the node runs for. On a node enrolled for a
 * PERSON (their laptop, phone, their always-on box) a contact's message is for the person: nothing answers it. On a
 * node running a FUNCTION profile — the household bot on its own node, `kind: 'function'` on its profile record — a
 * contact's message is for the bot, and the same assistant that answers Telegram answers it. The door follows the
 * profile, read once at boot; never a flag, never "not enrolled".
 *
 * The door is a MessagingBridge: the host lands the message in the inbox first (it is a contact's message, stored as
 * every other node stores one), then `feed`s it here; replies go back to the sender's address as a contact turn.
 * The person is the contact ROW (`chatId` = their id, the `webid`); a code from their card rides as `admission`.
 * `refuseOnce`: a contact who is not admitted is told so once, not on every message.
 *
 * Replies are text: a contact turn carries no buttons (a list's items are its lines).
 */

/**
 * @param {object} a
 * @param {() => Promise<'person'|'function'>} a.profileKind  the node's profile kind (the agent's `profileKind`)
 * @param {(turn: {peerAddr: string, text: string}) => Promise<unknown>} a.sendTurn  the contact channel's send
 * @returns {Promise<{bridge: object|null, feed: (msg: object) => boolean}>}  no bridge on a person's node
 */
export async function createInboxDoor({ profileKind, sendTurn }) {
  const kind = typeof profileKind === 'function' ? await profileKind() : 'person';
  if (kind !== 'function') return { bridge: null, feed: () => false };
  const bridge = createContactDoorBridge({ sendTurn });
  return { bridge, feed: (msg) => bridge.feed(msg) };
}

/** @param {{sendTurn: Function}} a */
export function createContactDoorBridge({ sendTurn }) {
  if (typeof sendTurn !== 'function') throw new TypeError('createContactDoorBridge: sendTurn is required');
  let handler = null;
  // The same message can arrive more than once (the pair route and the profile address): the door takes it once.
  const seen = new Set();
  const SEEN_MAX = 500;
  return {
    id: 'web',
    channel: 'web',
    async start() {},
    async stop() {},
    onMessage(h) { handler = h; },
    // A reply goes to the PERSON (their contact id), not to the address the message came from: once the two have a
    // pair circle, a message arrives from their per-circle address there, and a contact turn sent to that address
    // reaches nobody. The channel's own routing picks the way to the person, as it does for every shell's reply.
    async sendReply({ chatId, text }) {
      if (!chatId || typeof text !== 'string' || !text) return;
      await sendTurn({ peerAddr: chatId, threadId: chatId, text });
    },
    /**
     * A contact's message, already landed in the inbox by the host.
     * @param {{contactId: string, fromAddr: string, text: string, admission?: string, displayName?: string, messageId?: string}} msg
     * @returns {boolean} whether it went to the door
     */
    feed({ contactId, fromAddr, text, admission, displayName = null, messageId } = {}) {
      if (typeof handler !== 'function' || !contactId || !fromAddr || typeof text !== 'string' || !text.trim()) return false;
      if (messageId) {
        if (seen.has(messageId)) return false;
        seen.add(messageId);
        if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
      }
      handler({
        bridgeId: 'web', channel: 'web', chatId: contactId, messageId, text,
        ...(typeof admission === 'string' && admission ? { admission } : {}),
        refuseOnce: true,
        slash: false,   // a contact turn is words: this door has no commands to point at
        sender: { bridgeUid: contactId, displayName },
      });
      return true;
    },
  };
}
