/**
 * chatManifest — the DECLARED contract for the chat lane's log entries.
 *
 * Fourth sibling of `governanceManifest` / `membershipManifest` / `taskManifest`: which signed statement
 * kinds the chat lane of the device log carries. The rail refuses anything else at both ends.
 *
 * The chat lane differs from every other lane in one way: its log entries ARE the product surface. A chat
 * entry is the canonical render event the bubbles already read (id = msgId, `payload.text`, the media
 * card, …) with the signed statement attached at `payload.statement` — so the conversation renders
 * unchanged while every message becomes verifiable, and the entry-kind table's RECORD class makes the log
 * the conversation's durable record.
 */

/** The device-log lane chat statements ride — the same name as the render entries' type, so the one
 *  entry serves both roles (the shared entry-kind table classes it HUMAN / wakes / RECORD). */
export const CHAT_LANE = 'chat-message';

export const chatManifest = Object.freeze({
  app: 'chat-lane',
  itemTypes: [],
  nouns: {},
  operations: [
    {
      id: 'chat.message',
      description: 'A chat message: the writer signs the wire payload (msgId, text, media pointer) with their per-circle key; receivers verify before it lands and renders.',
      appends: [{ lane: CHAT_LANE, kind: 'message' }],
    },
  ],
});

export default chatManifest;
