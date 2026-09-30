/**
 * doorReach — the bot writes FIRST to a person (a reminder), on that person's own door.
 *
 * Every other message a door sends answers one the person just sent, on the chat it came from. A reminder has no such
 * chat: the contact row says where the person is (their `channel` and id) and that picks the door — Telegram: their
 * private chat (the chat id of a private chat is the user's id); the inbox: a contact turn to their id.
 *   - a revoked person (the row hidden) gets nothing;
 *   - Telegram refusing ("the bot can't initiate a conversation": a person who only ever spoke in a group) is kept on
 *     their thread row, and the bot does not try again until they next write;
 *   - what was sent is remembered in their thread as the assistant's words (unless their memory is off), so an answer
 *     right after it ("gedaan") reads against it.
 */

/** Telegram's answer when the bot may not start a chat with this person. */
const cannotStart = (err) => err?.code === 403 || /forbidden|can'?t initiate|blocked by the user|chat not found/i.test(String(err?.message ?? err ?? ''));

/**
 * @param {object} a
 * @param {{telegram?: {sendReply: Function}, web?: {sendReply: Function}}} a.bridges  the doors, by the channel they serve
 * @param {{list: () => Promise<Array<{id:string, channel:string, uid:string, hidden?:boolean}>>}} a.users  the bot's people
 * @param {object} a.threads  the thread rows (`botThreads`)
 */
export function createPersonReach({ bridges = {}, users, threads }) {
  return {
    /**
     * @param {string} contactId
     * @param {{text: string, buttons?: Array<{id:string, label:string}>}} message
     * @returns {Promise<{ok: true} | {ok: false, reason: 'revoked'|'no-door'|'no-private-chat'|'failed'}>}
     */
    async sendToPerson(contactId, { text, buttons } = {}) {
      const rows = (await users.list().catch(() => [])) ?? [];
      const row = rows.find((r) => r?.id === contactId) ?? null;
      if (row?.hidden) return { ok: false, reason: 'revoked' };
      const door = row ? bridges[row.channel] : null;
      if (!row || !door || typeof door.sendReply !== 'function') return { ok: false, reason: 'no-door' };
      const kept = threads.unreachableOf(contactId);
      if (kept) return { ok: false, reason: kept };
      const chatId = row.channel === 'web' ? contactId : String(row.uid ?? '').trim();
      try {
        await door.sendReply({ chatId, text, ...(Array.isArray(buttons) && buttons.length ? { buttons } : {}) });
      } catch (err) {
        if (row.channel === 'telegram' && cannotStart(err)) { threads.markUnreachable(contactId, 'no-private-chat'); return { ok: false, reason: 'no-private-chat' }; }
        return { ok: false, reason: 'failed' };   // the next tick tries again
      }
      threads.memory.remember(contactId, 'assistant', text);
      return { ok: true };
    },
  };
}
