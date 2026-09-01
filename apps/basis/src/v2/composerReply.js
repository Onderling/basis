/**
 * composerReply — what an op's reply BECOMES in the conversation.
 *
 * Every door into a circle composer now ends in the same place: `callSkill('basis', opId, args)` from
 * the + menu, from a typed `/command`, later from an item's own share button. What comes back is not
 * one shape — an op that acts returns a card (`{kind:'time-card', snapshot, …}`), an op that reports
 * returns `{message}`, an op that refuses returns `{ok:false, error}` — and each door was deciding for
 * itself what to do with that. The typed door printed `message` and rendered a card as nothing; the +
 * menu's tap did not render anything at all.
 *
 * So the decision lives here, once, and each shell only paints it:
 *
 *   `{kind:'card', card, text}`  the message the CIRCLE sees — appended to the stream and fanned out.
 *                                `text` is the caption: a shell (or a peer) that paints no card still
 *                                shows a sentence, never an empty bubble.
 *   `{kind:'note', text}`        a local answer, for the person who asked. Scope 'self' by
 *                                construction: `/whoami` carries a session id, `/debug-dump` a device
 *                                snapshot, and neither is the circle's business.
 *   `null`                       the op said nothing worth showing (it already spoke another way).
 *
 * Pure: no DOM, no React, no agent, no locale bundle — `t` is injected.
 */

/** A card is any `*-card` embed. The variants live in the manifest and the renderers, not in a list here. */
export function isCardReply(reply) {
  return !!reply && typeof reply === 'object' && !Array.isArray(reply)
    && typeof reply.kind === 'string' && reply.kind.endsWith('-card');
}

/** The caption a card rides under, per variant — what a person reads when the card cannot be painted. */
const CAPTION_KEY = Object.freeze({
  'time-card':  'circle.card.appointment',
  'item-card':  'circle.card.item',
  'file-card':  'circle.card.file',
  'media-card': 'circle.card.photo',
});

/**
 * @param {*} reply                      whatever the op returned
 * @param {object} [ctx]
 * @param {(k: string, vars?: object) => string} [ctx.t]   locale resolver
 * @returns {{kind:'card', card: object, text: string}|{kind:'note', text: string}|null}
 */
export function composerReplyToStream(reply, { t = (k) => k } = {}) {
  if (reply == null) return null;

  if (isCardReply(reply)) {
    // The title comes from the card's own snapshot — the same field the renderer paints — so the
    // caption and the card can never describe different things.
    const title = String(reply.snapshot?.title ?? reply.snapshot?.name ?? reply.snapshot?.id ?? '').trim();
    const key = CAPTION_KEY[reply.kind] ?? 'circle.card.item';
    return { kind: 'card', card: reply, text: t(key, { title }) };
  }

  // A refusal is the person's own business — it says what THIS device could not do.
  if (reply.ok === false) {
    const said = typeof reply.error === 'string' ? reply.error
      : typeof reply.message === 'string' ? reply.message : '';
    return said ? { kind: 'note', text: said } : null;
  }

  if (typeof reply.message === 'string' && reply.message) return { kind: 'note', text: reply.message };

  // An op that returned data with nothing to say. Rendering `{"ok":true}` into a conversation is worse
  // than silence, and the op's own surface (a list, a panel) is where its data belongs.
  return null;
}

export default composerReplyToStream;
